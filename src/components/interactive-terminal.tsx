import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { API } from '../types';
import { Button } from './ui/button';

export function InteractiveTerminal({ api, cwd, visible, disabled, onAttach }: { api: API; cwd: string; visible: boolean; disabled: boolean; onAttach: (text: string) => void }) {
  const element = useRef<HTMLDivElement>(null);
  const terminal = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const shell = useRef<string | null>(null);
  const [error, setError] = useState('');
  const [exited, setExited] = useState(false);
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    const term = new Terminal({ fontSize: 12, fontFamily: 'Menlo, monospace', cursorBlink: true, scrollback: 3000, theme: { background: '#101316', foreground: '#f4f4f5', cursor: '#a1a1aa' } });
    const addon = new FitAddon(); term.loadAddon(addon); term.open(element.current!); terminal.current=term;fit.current=addon;
    let disposed=false, timer: ReturnType<typeof setTimeout>, cursor=0; setError('');setExited(false);
    const report=(e: unknown)=>{if(!disposed)setError(e instanceof Error?e.message:String(e));};
    const input=term.onData(data=>{if(shell.current)void api.ptyWrite(shell.current,data).catch(report);});
    const resize=()=>{if(element.current?.getBoundingClientRect().width){addon.fit();if(shell.current)void api.ptyResize(shell.current,term.cols,term.rows).catch(report);}};
    const observer=new ResizeObserver(resize);observer.observe(element.current!);
    void (async()=>{try {
      addon.fit(); const result=await api.ptyOpen(cwd,Math.max(2,term.cols),Math.max(2,term.rows));
      if(disposed){await api.ptyClose(result.id);return;}shell.current=result.id;term.focus();
      const poll=async()=>{try{const next=await api.ptyRead(result.id,cursor);if(disposed)return;cursor=next.cursor;if(next.truncated)term.write('\r\n[Earlier output omitted]\r\n');term.write(next.data);if(next.exited){setExited(true);if(next.error)setError(next.error);return;}timer=setTimeout(poll,75);}catch(e){report(e);setExited(true);}};
      await poll();
    }catch(e){report(e);setExited(true);}})();
    return()=>{disposed=true;clearTimeout(timer);observer.disconnect();input.dispose();term.dispose();terminal.current=null;fit.current=null;const id=shell.current;shell.current=null;if(id)void api.ptyClose(id).catch(()=>{});};
  },[api,cwd,generation]);
  useEffect(()=>{if(visible){fit.current?.fit();terminal.current?.focus();}},[visible]);
  function attach() { const buffer=terminal.current?.buffer.active;if(!buffer)return;const lines=[];for(let i=Math.max(0,buffer.length-300);i<buffer.length;i++)lines.push(buffer.getLine(i)?.translateToString(true)||'');onAttach(lines.join('\n').trim().slice(-28000)); }
  return <div hidden={!visible} className="terminal-pane">
    <div ref={element} className="terminal-emulator" aria-label="Interactive terminal"/>
    <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-1 text-xs text-muted-foreground"><span className="truncate">{exited?'Shell exited':cwd}</span><div className="flex gap-1"><Button size="sm" variant="ghost" disabled={disabled} onClick={attach}>Attach output</Button><Button size="sm" variant="ghost" onClick={()=>setGeneration(n=>n+1)}>{exited?'Restart terminal':'New shell'}</Button></div></div>
    {error&&<p role="alert" className="max-h-16 overflow-auto px-3 text-xs text-destructive">{error}</p>}
  </div>;
}

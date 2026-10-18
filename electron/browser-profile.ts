import { app, dialog, safeStorage, shell, type Session, type WebContents, type DownloadItem } from 'electron';
import { readFile, writeFile, rename, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parsePasswordCSV } from './browser-import';
export class BrowserProfile {
  history: {url:string;title:string;at:string}[]=[];
  downloads: {id:string;name:string;path:string;state:string;received:number;total:number}[]=[];
  settings={home:'http://localhost:3000',rememberHistory:true};
  private credentials: {id:string;origin:string;username:string;secret:string}[]=[];
  private configured = new WeakSet<Session>();
  private items=new Map<string,DownloadItem>();
  private saves=Promise.resolve();
  constructor(private root=join(app.getPath('userData'),'browser')){}
  async load(){try{const data=JSON.parse(await readFile(join(this.root,'profile.json'),'utf8'));this.history=data.history||[];this.settings={...this.settings,...data.settings};this.credentials=data.credentials||[];this.downloads=(data.downloads||[]).map((d:any)=>({...d,state:d.state==='completed'?'completed':'interrupted'}));}catch(e:any){if(e.code!=='ENOENT')throw e;}}
  private save(){const text=JSON.stringify({history:this.history,settings:this.settings,credentials:this.credentials,downloads:this.downloads});this.saves=this.saves.catch(()=>{}).then(async()=>{await mkdir(this.root,{recursive:true});await writeFile(join(this.root,'profile.json.tmp'),text,{mode:0o600});await rename(join(this.root,'profile.json.tmp'),join(this.root,'profile.json'));});return this.saves;}
  visit(url:string,title:string){if(!this.settings.rememberHistory||!/^https?:/.test(url))return;this.history=[{url,title:title||url,at:new Date().toISOString()},...this.history.filter(h=>h.url!==url)].slice(0,500);void this.save().catch(console.error);}
  configure(session:Session){if(this.configured.has(session))return;this.configured.add(session);session.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));session.setPermissionCheckHandler(()=>false);
    session.on('will-download',(_event,item)=>{const id=randomUUID();const record={id,name:item.getFilename(),path:'',state:'progressing',received:0,total:item.getTotalBytes()};this.downloads.unshift(record);this.downloads=this.downloads.slice(0,100);this.items.set(id,item);item.setSaveDialogOptions({title:'Save download'});item.on('updated',()=>{record.path=item.getSavePath();record.received=item.getReceivedBytes();record.state=item.isPaused()?'paused':item.getState();});item.once('done',(_e,state)=>{record.path=item.getSavePath();record.received=item.getReceivedBytes();record.state=state;this.items.delete(id);void this.save().catch(console.error);});});
  }
  summary(){return {history:this.history,downloads:this.downloads,settings:this.settings,credentials:this.credentials.map(({id,origin,username})=>({id,origin,username}))};}
  async action(wc:WebContents,action:string,value:any){
    if(action==='profile')return this.summary();
    if(action==='settings'){const url=new URL(value.home);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('Enter an HTTP(S) home page URL.');this.settings={home:url.href,rememberHistory:value.rememberHistory===true};await this.save();return;}
    if(action==='clear'){if(value==='history')this.history=[];else if(value==='passwords')this.credentials=[];else if(value==='cache')await wc.session.clearCache();else if(value==='cookies')await wc.session.clearStorageData({storages:['cookies','localstorage','indexdb','serviceworkers','cachestorage']});else throw new Error('Choose browsing data to clear.');await this.save();return;}
    if(action==='download'){const record=this.downloads.find(d=>d.id===value.id);if(!record)throw new Error('Download not found');const item=this.items.get(record.id);if(value.command==='cancel')item?.cancel();else if(value.command==='pause')item?.pause();else if(value.command==='resume')item?.resume();else if(value.command==='reveal'&&record.path&&record.state==='completed')shell.showItemInFolder(record.path);else throw new Error('Download action unavailable');return;}
    if(action==='import'){
      if(!['cookies','passwords'].includes(value))throw new Error('Choose an import type.');
      const selected=await dialog.showOpenDialog({title:value==='cookies'?'Import cookies (JSON)':'Import passwords (CSV)',properties:['openFile'],filters:[{name:value==='cookies'?'Cookies':'Passwords',extensions:[value==='cookies'?'json':'csv']}]});
      if(selected.canceled)return null;const path=selected.filePaths[0];if((await stat(path)).size>5_000_000)throw new Error('Import files must be under 5 MB.');const text=await readFile(path,'utf8');
      if(value==='cookies'){const cookies=JSON.parse(text);if(!Array.isArray(cookies)||cookies.length>5000)throw new Error('Choose a JSON array of up to 5,000 cookies.');let count=0;for(const row of cookies){const domain=typeof row.domain==='string'?row.domain.replace(/^\./,''):'';const url=new URL(row.url||`${row.secure?'https':'http'}://${domain}${row.path||'/'}`);if(!['https:','http:'].includes(url.protocol)||url.username||url.password||typeof row.name!=='string'||typeof row.value!=='string')throw new Error(`Invalid cookie at row ${count+1}. ${count} imported.`);await wc.session.cookies.set({url:url.href,name:row.name,value:row.value,...(domain?{domain:row.domain}:{}),path:row.path||'/',secure:row.secure===true,httpOnly:row.httpOnly===true,...(Number.isFinite(row.expirationDate)?{expirationDate:row.expirationDate}:{})});count++;}return `${count} cookies imported`;
      }
      if(!safeStorage.isEncryptionAvailable()||(process.platform==='linux'&&safeStorage.getSelectedStorageBackend()==='basic_text'))throw new Error('Secure OS credential storage is unavailable.');
      const rows=parsePasswordCSV(text);for(const row of rows){const existing=this.credentials.find(c=>c.origin===row.origin&&c.username===row.username);const entry={id:existing?.id||randomUUID(),origin:row.origin,username:row.username,secret:safeStorage.encryptString(row.password).toString('base64')};this.credentials=this.credentials.filter(c=>c.id!==entry.id);this.credentials.push(entry);}await this.save();return `${rows.length} passwords imported`;
    }
    if(action==='delete-password'){this.credentials=this.credentials.filter(c=>c.id!==value);await this.save();return;}
    if(action==='autofill'){
      const entry=this.credentials.find(c=>c.id===value);const origin=new URL(wc.getURL()).origin;if(!entry||entry.origin!==origin)throw new Error('Open the exact saved origin before filling credentials.');
      const secret=safeStorage.decryptString(Buffer.from(entry.secret,'base64'));
      const result=await wc.executeJavaScriptInIsolatedWorld(998,[{code:`(()=>{if(location.origin!==${JSON.stringify(origin)})return false;const p=[...document.querySelectorAll('input[type=password]')].find(e=>e.getClientRects().length);if(!p)return false;const form=p.form||document;const u=[...form.querySelectorAll('input')].find(e=>e!==p&&e.getClientRects().length&&(['email','text'].includes(e.type)||e.autocomplete==='username'));const set=(e,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));};if(u)set(u,${JSON.stringify(entry.username)});set(p,${JSON.stringify(secret)});return true;})()`}]);if(!result)throw new Error('No visible login form found.');return 'Login filled. Submit the form when ready.';
    }
    throw new Error('Unsupported browser action');
  }
}

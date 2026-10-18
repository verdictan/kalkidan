// Parse standard Chrome/Firefox password CSV exports, including quoted commas/newlines.
export function parsePasswordCSV(text:string){
  const rows:string[][]=[];let row:string[]=[],field='',quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(field);field='';}else if(c==='\n'&&!quoted){row.push(field.replace(/\r$/,''));rows.push(row);row=[];field='';}else field+=c;}
  if(quoted)throw new Error('Unterminated quoted CSV field.');if(field||row.length){row.push(field.replace(/\r$/,''));rows.push(row);}const header=rows.shift()?.map(c=>c.replace(/^\uFEFF/,'').trim().toLowerCase())||[];
  const url=header.indexOf('url'),username=header.indexOf('username'),password=header.indexOf('password');if([url,username,password].some(i=>i<0))throw new Error('CSV must contain url, username, and password columns.');
  return rows.filter(r=>r.some(Boolean)).map((r,i)=>{const u=new URL(r[url]);if(!['https:','http:'].includes(u.protocol)||u.username||u.password||!r[password])throw new Error(`Invalid password row ${i+2}.`);return {origin:u.origin,username:r[username]||'',password:r[password]};});
}

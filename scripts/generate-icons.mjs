import { Resvg } from '@resvg/resvg-js';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const brand = root + 'public/brand/';
const build = root + 'build/icons/';
await mkdir(brand, { recursive: true });
await mkdir(build + 'kalkidan.iconset', { recursive: true });
const defs = `<defs>
 <path id="petal" d="M512 222 C470 248 466 277 488 302 C500 316 510 328 512 350 C514 328 524 316 536 302 C558 277 554 248 512 222Z"/>
</defs>`;
const k = '<path transform="translate(-12 0)" d="M474 455H497V502L540 455H570L520 510L574 571H543L497 519V571H474Z" fill="#dfba65"/>';
function shield(simple=false) {
 const count=simple?8:12;
 const petals=Array.from({length:count},(_,i)=>`<g transform="rotate(${i*360/count} 512 512)"><use href="#petal" fill="#dfba65"/>${simple?'':`<path d="M512 246L501 265L512 284L523 265Z" fill="#343322"/><path d="M512 302V322" stroke="#75612f" stroke-width="4" stroke-linecap="round"/>`}</g>`).join('');
 const rivets=simple?'':Array.from({length:24},(_,i)=>{const a=i*Math.PI/12;return `<circle cx="${(512+322*Math.sin(a)).toFixed(2)}" cy="${(512-322*Math.cos(a)).toFixed(2)}" r="4" fill="#f6dd91"/>`;}).join('');
 return `<circle cx="512" cy="524" r="350" fill="#050b08" opacity=".35"/><circle cx="512" cy="512" r="350" fill="#dfba65"/><circle cx="512" cy="512" r="335" fill="#292d23" stroke="#ae8d48" stroke-width="3"/><circle cx="512" cy="512" r="302" fill="none" stroke="#a98841" stroke-width="3" opacity=".6"/>${rivets}${petals}<circle cx="512" cy="512" r="188" fill="none" stroke="#dfba65" stroke-width="12"/><circle cx="512" cy="512" r="171" fill="none" stroke="#bba258" stroke-width="2" opacity=".5"/>${simple?'':Array.from({length:12},(_,i)=>`<path d="M512 355L518 365L512 375L506 365Z" fill="#dfba65" transform="rotate(${i*30} 512 512)"/>`).join('')}<circle cx="512" cy="518" r="129" fill="#050b08" opacity=".4"/><circle cx="512" cy="512" r="125" fill="#dfba65"/><circle cx="512" cy="512" r="109" fill="#18221c" stroke="#f2d68c" stroke-width="2"/>${k}`;
}
const svg=(body,description='Kalkidan — a gold shield with radial leaf ornaments and a central K')=>`<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" role="img"><title>Kalkidan</title><desc>${description}</desc>${defs}${body}</svg>`;
const tile='<rect x="64" y="64" width="896" height="896" rx="204" fill="#ffffff"/><rect x="65.5" y="65.5" width="893" height="893" rx="202.5" fill="none" stroke="#6f7261" stroke-opacity=".35" stroke-width="3"/>';
const master=svg(tile+shield());
const compact=svg(tile+shield(true));
const mark=svg(shield());
const mono=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024"><title>Kalkidan monochrome shield</title><g fill="none" stroke="currentColor"><circle cx="512" cy="512" r="350" stroke-width="36"/><circle cx="512" cy="512" r="147" stroke-width="24"/>${Array.from({length:8},(_,i)=>`<path d="M512 231Q466 273 512 332Q558 273 512 231Z" fill="currentColor" stroke="none" transform="rotate(${i*45} 512 512)"/>`).join('')}</g><path d="M467 444H495V501L545 444H580L520 510L584 580H548L495 522V580H467Z" fill="currentColor"/></svg>`;
// Optical small-size drawing: larger K, thicker rim, fewer interior details.
const tiny=svg(tile+`<circle cx="512" cy="512" r="356" fill="#dfba65"/><circle cx="512" cy="512" r="304" fill="#1a231c"/>${Array.from({length:8},(_,i)=>`<path d="M512 245L543 307L512 350L481 307Z" fill="#dfba65" transform="rotate(${i*45} 512 512)"/>`).join('')}<circle cx="512" cy="512" r="140" fill="none" stroke="#dfba65" stroke-width="22"/><g transform="translate(-102.4 -102.4) scale(1.2)">${k}</g>`);
for(const [name,source] of [['kalkidan-icon',master],['kalkidan-mark',mark],['kalkidan-compact',compact],['kalkidan-monochrome',mono],['favicon',tiny]])await writeFile(brand+name+'.svg',source);
const render=(source,size)=>new Resvg(source,{fitTo:{mode:'width',value:size}}).render().asPng();
const sizes=[16,20,24,29,32,40,48,58,60,64,76,80,87,96,120,128,152,167,180,192,256,384,512,1024,2048,4096];
for(const size of sizes)await writeFile(brand+`icon-${size}.png`,render(size<=48?tiny:size<=128?compact:master,size));
for(const size of [16,32,128,256,512]){
 for(const scale of [1,2]){const pixels=size*scale;await writeFile(build+`kalkidan.iconset/icon_${size}x${size}${scale===2?'@2x':''}.png`,render(pixels<=48?tiny:pixels<=128?compact:master,pixels));}
}
await writeFile(build+'icon.png',render(master,1024));
if(process.platform==='darwin')execFileSync('iconutil',['-c','icns',build+'kalkidan.iconset','-o',build+'icon.icns']);
// PNG-compressed ICO images retain full alpha and avoid palette quantization.
const icoSizes=[16,32,48,64,128,256];const images=icoSizes.map(n=>render(n<=48?tiny:n<=128?compact:master,n));const header=Buffer.alloc(6+16*images.length);header.writeUInt16LE(1,2);header.writeUInt16LE(images.length,4);let offset=header.length;images.forEach((png,i)=>{const p=6+i*16;header[p]=icoSizes[i]===256?0:icoSizes[i];header[p+1]=header[p];header.writeUInt16LE(1,p+4);header.writeUInt16LE(32,p+6);header.writeUInt32LE(png.length,p+8);header.writeUInt32LE(offset,p+12);offset+=png.length;});const ico=Buffer.concat([header,...images]);await writeFile(build+'icon.ico',ico);await writeFile(root+'public/favicon.ico',ico);
await writeFile(root+'public/site.webmanifest',JSON.stringify({name:'Kalkidan',short_name:'Kalkidan',icons:[{src:'brand/icon-192.png',sizes:'192x192',type:'image/png'},{src:'brand/icon-512.png',sizes:'512x512',type:'image/png'}],theme_color:'#1c2321',background_color:'#101316',display:'standalone'},null,2));
// Presentation sheet, rasterized only for easy review. Source assets above remain vector.
const embed=(source,x,y,w)=>`<image x="${x}" y="${y}" width="${w}" height="${w}" href="data:image/svg+xml;base64,${Buffer.from(source).toString('base64')}"/>`;
const sheet=`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000"><rect width="1600" height="1000" fill="#101816"/><text x="80" y="95" font-family="Arial" font-size="28" letter-spacing="5" fill="#ecd391">KALKIDAN</text><text x="80" y="138" font-family="Arial" font-size="18" fill="#9ba49d">A shield for the work you bring together.</text>${embed(master,30,175,660)}${embed(mark,850,140,450)}<text x="960" y="608" font-family="Arial" font-size="16" fill="#a4ada6">Independent vector mark</text><line x1="780" y1="680" x2="1500" y2="680" stroke="#344038"/>${[16,32,64,128,256].map((n,i)=>embed(n<=48?tiny:n<=128?compact:master,800+i*140,730,Math.min(n,128))+`<text x="${800+i*140}" y="900" font-family="Arial" font-size="16" fill="#a4ada6">${n === 256 ? '256 px source' : n + ' px'}</text>`).join('')}<text x="80" y="940" font-family="Arial" font-size="18" fill="#a4ada6">Antique gold · white tile · clear at every scale</text></svg>`;await writeFile(brand+'icon-preview.png',render(sheet,1600));
console.log('Generated vector masters, 26 PNG sizes, macOS iconset/ICNS, ICO, and web manifest.');

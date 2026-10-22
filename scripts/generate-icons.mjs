import { Resvg } from '@resvg/resvg-js';
import { mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const brand = root + 'public/brand/';
const build = root + 'build/icons/';
await mkdir(brand, { recursive: true });
await mkdir(build + 'kalkidan.iconset', { recursive: true });
// The Brackets mark: two square brackets hold one brown point. It is drawn in a 100-unit box.
// `small` is the optical form for 48 px and below: heavier strokes and a larger point.
const ink = '#171717';
const brown = '#9a4600';
function brackets({ small = false, color } = {}) {
  const stroke = color || ink;
  const point = color || brown;
  const width = small ? 12 : 9;
  const path = (d) =>
    `<path d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round"/>`;
  return `${path('M34 18H20V82H34')}${path('M66 18H80V82H66')}<circle cx="50" cy="50" r="${small ? 11 : 9}" fill="${point}"/>`;
}
const place = (body, x, scale) => `<g transform="translate(${x} ${x}) scale(${scale})">${body}</g>`;
const svg = (body, description = 'Kalkidan — two square brackets that hold one brown point') =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024" role="img"><title>Kalkidan</title><desc>${description}</desc>${body}</svg>`;
const tile =
  '<rect x="64" y="64" width="896" height="896" rx="204" fill="#ffffff"/><rect x="65.5" y="65.5" width="893" height="893" rx="202.5" fill="none" stroke="#171717" stroke-opacity=".12" stroke-width="3"/>';
// App icon: the mark fills 62% of the white tile.
const master = svg(tile + place(brackets(), 232, 5.6));
const compact = svg(tile + place(brackets({ small: true }), 212, 6));
const mark = svg(place(brackets(), 0, 10.24));
const mono = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="1024" height="1024"><title>Kalkidan monochrome mark</title>${brackets({ color: 'currentColor' })}</svg>`;
// Optical small-size drawing: heavier strokes and a larger point on a fuller tile.
const tiny = svg(tile + place(brackets({ small: true }), 192, 6.4));
for (const [name, source] of [
  ['kalkidan-icon', master],
  ['kalkidan-mark', mark],
  ['kalkidan-compact', compact],
  ['kalkidan-monochrome', mono],
  ['favicon', tiny],
])
  await writeFile(brand + name + '.svg', source);
const render = (source, size) =>
  new Resvg(source, { fitTo: { mode: 'width', value: size } }).render().asPng();
const sizes = [
  16, 20, 24, 29, 32, 40, 48, 58, 60, 64, 76, 80, 87, 96, 120, 128, 152, 167, 180, 192, 256, 384,
  512, 1024, 2048, 4096,
];
for (const size of sizes)
  await writeFile(
    brand + `icon-${size}.png`,
    render(size <= 48 ? tiny : size <= 128 ? compact : master, size),
  );
for (const size of [16, 32, 128, 256, 512]) {
  for (const scale of [1, 2]) {
    const pixels = size * scale;
    await writeFile(
      build + `kalkidan.iconset/icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`,
      render(pixels <= 48 ? tiny : pixels <= 128 ? compact : master, pixels),
    );
  }
}
await writeFile(build + 'icon.png', render(master, 1024));
if (process.platform === 'darwin')
  execFileSync('iconutil', ['-c', 'icns', build + 'kalkidan.iconset', '-o', build + 'icon.icns']);
// PNG-compressed ICO images retain full alpha and avoid palette quantization.
const icoSizes = [16, 32, 48, 64, 128, 256];
const images = icoSizes.map((n) => render(n <= 48 ? tiny : n <= 128 ? compact : master, n));
const header = Buffer.alloc(6 + 16 * images.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(images.length, 4);
let offset = header.length;
images.forEach((png, i) => {
  const p = 6 + i * 16;
  header[p] = icoSizes[i] === 256 ? 0 : icoSizes[i];
  header[p + 1] = header[p];
  header.writeUInt16LE(1, p + 4);
  header.writeUInt16LE(32, p + 6);
  header.writeUInt32LE(png.length, p + 8);
  header.writeUInt32LE(offset, p + 12);
  offset += png.length;
});
const ico = Buffer.concat([header, ...images]);
await writeFile(build + 'icon.ico', ico);
await writeFile(root + 'public/favicon.ico', ico);
await writeFile(
  root + 'public/site.webmanifest',
  JSON.stringify(
    {
      name: 'Kalkidan',
      short_name: 'Kalkidan',
      icons: [
        { src: 'brand/icon-192.png', sizes: '192x192', type: 'image/png' },
        { src: 'brand/icon-512.png', sizes: '512x512', type: 'image/png' },
      ],
      theme_color: '#fafafa',
      background_color: '#ffffff',
      display: 'standalone',
    },
    null,
    2,
  ),
);
// Presentation sheet, rasterized only for easy review. Source assets above remain vector.
const embed = (source, x, y, w) =>
  `<image x="${x}" y="${y}" width="${w}" height="${w}" href="data:image/svg+xml;base64,${Buffer.from(source).toString('base64')}"/>`;
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1000" viewBox="0 0 1600 1000"><rect width="1600" height="1000" fill="#fafafa"/><text x="80" y="95" font-family="Arial" font-size="28" letter-spacing="5" fill="#171717">KALKIDAN</text><text x="80" y="138" font-family="Arial" font-size="18" fill="#6b6b6b">Agents that keep to your rules.</text>${embed(master, 30, 175, 660)}${embed(mark, 850, 140, 450)}<text x="960" y="608" font-family="Arial" font-size="16" fill="#6b6b6b">Independent vector mark</text><line x1="780" y1="680" x2="1500" y2="680" stroke="#e5e5e5"/>${[16, 32, 64, 128, 256].map((n, i) => embed(n <= 48 ? tiny : n <= 128 ? compact : master, 800 + i * 140, 730, Math.min(n, 128)) + `<text x="${800 + i * 140}" y="900" font-family="Arial" font-size="16" fill="#6b6b6b">${n === 256 ? '256 px source' : n + ' px'}</text>`).join('')}<text x="80" y="940" font-family="Arial" font-size="18" fill="#6b6b6b">Ink and Verdictan brown · white tile · clear at every scale</text></svg>`;
await writeFile(brand + 'icon-preview.png', render(sheet, 1600));
console.log('Generated vector masters, 26 PNG sizes, macOS iconset/ICNS, ICO, and web manifest.');

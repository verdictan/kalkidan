# Kalkidan identity

The Brackets mark: two square brackets in ink (#171717) hold one point in Verdictan brown
(#9a4600). A promise is a boundary you keep, and brackets are where code keeps its scope. The
app icon sets the mark on a white tile. The colors match the light theme of the app.

## Assets

- `public/brand/kalkidan-icon.svg`: scalable full-detail app icon master.
- `public/brand/kalkidan-mark.svg`: transparent standalone mark.
- `public/brand/kalkidan-compact.svg`: heavier strokes for medium sizes.
- `public/brand/favicon.svg`: optically adjusted small icon.
- `public/brand/kalkidan-monochrome.svg`: single-color `currentColor` mark; inline the SVG to inherit the surrounding text color.
- `public/brand/icon-*.png`: 26 lossless RGBA exports, from 16 through 4096 pixels.
- `build/icons/icon.icns`: macOS app icon with standard and Retina representations.
- `build/icons/kalkidan.iconset/`: all ten native macOS source slots.
- `build/icons/icon.ico`: six embedded sizes, from 16 through 256 pixels.
- `public/favicon.ico`, `public/site.webmanifest`: browser assets.

## Regeneration

Run `npm run generate:icons`. Geometry, colors, and export sizes are defined in
`scripts/generate-icons.mjs`. SVG masters contain paths with solid-color fills, not a bitmap;
PNG exports are rendered directly from those vectors with resvg. Small sizes use
simpler shapes and heavier lines instead of merely shrinking the detailed master.
ICNS generation requires macOS `iconutil`; other assets can be regenerated elsewhere.

The app header and development Dock use these assets. The Electron Builder macOS
configuration uses `icon.icns` for packaged apps. Restart the development app to
refresh its Dock icon; rebuild installed apps with `npm run dist:mac`.

// Renders Finlyt's brand PNGs from the "Finlyt logo" canvas geometry.
// Usage (from mobile/): npm i --no-save @resvg/resvg-js@2.6.2 && node scripts/render-brand.js
// Writes into assets/images by default; pass another folder to preview first.
const fs = require("fs");
const path = require("path");
const { Resvg } = require("@resvg/resvg-js");

const out = process.argv[2] ?? path.join(__dirname, "..", "assets", "images");
const BRAND = "#3355FF";
const TINT = "#AEBBFF";
const WHITE = "#FFFFFF";

// Coin agent in a 100x100 space, centred (Final.dc.html).
const COIN_T = 'transform="translate(-1.48 -1.74) rotate(-10 50 52)"';
const coin = (face = WHITE, eyes = BRAND) => `
  <g ${COIN_T}>
    <path d="M47 21H56A26 31 0 0 1 56 83H47Z" fill="${TINT}"/>
    <ellipse cx="47" cy="52" rx="26" ry="31" fill="${face}"/>
    <ellipse cx="47" cy="52" rx="20" ry="25" fill="none" stroke="${TINT}" stroke-width="3"/>
    <ellipse cx="40.5" cy="51" rx="5" ry="7.6" fill="${eyes}"/>
    <ellipse cx="53.5" cy="51" rx="5" ry="7.6" fill="${eyes}"/>
  </g>`;

// One-colour coin (themed icon / notification), eyes and ring cut out.
const coinMono = (fill) => `
  <g ${COIN_T}>
    <path fill-rule="evenodd" fill="${fill}" d="M21 52A26 31 0 1 0 73 52A26 31 0 1 0 21 52ZM25.5 52A21.5 26.5 0 1 0 68.5 52A21.5 26.5 0 1 0 25.5 52ZM28.5 52A18.5 23.5 0 1 0 65.5 52A18.5 23.5 0 1 0 28.5 52ZM35.5 51A5 7.6 0 1 0 45.5 51A5 7.6 0 1 0 35.5 51ZM48.5 51A5 7.6 0 1 0 58.5 51A5 7.6 0 1 0 48.5 51Z"/>
    <path fill="${fill}" d="M57.16 21.03A26 31 0 0 1 57.16 82.97A28.2 33.2 0 0 0 57.16 21.03Z"/>
  </g>`;

// The bare coin in any colours (no rounded square), as on the logo canvas's no-background board.
const coinColored = (face, rim, ring, eyes) => `
  <g ${COIN_T}>
    <path d="M47 21H56A26 31 0 0 1 56 83H47Z" fill="${rim}"/>
    <ellipse cx="47" cy="52" rx="26" ry="31" fill="${face}"/>
    <ellipse cx="47" cy="52" rx="20" ry="25" fill="none" stroke="${ring}" stroke-width="3"/>
    <ellipse cx="40.5" cy="51" rx="5" ry="7.6" fill="${eyes}"/>
    <ellipse cx="53.5" cy="51" rx="5" ry="7.6" fill="${eyes}"/>
  </g>`;

const svg = (viewBox, size, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${size}" height="${size}">${body}</svg>`;

// Adaptive icons are 108dp with the visible 72dp in the middle: the canvas's 100-unit
// icon maps onto that 72dp, so the full 108dp layer is viewBox -25 -25 150 150.
const ADAPTIVE = "-25 -25 150 150";

const assets = {
  // Store / legacy icon: full-bleed brand square (launchers apply their own mask).
  "icon.png": svg("0 0 100 100", 1024, `<rect width="100" height="100" fill="${BRAND}"/>${coin()}`),
  "android-icon-foreground.png": svg(ADAPTIVE, 1024, coin()),
  "android-icon-monochrome.png": svg(ADAPTIVE, 1024, coinMono(WHITE)),
  // Splash: the coin alone on the brand-blue splash background.
  "splash-icon.png": svg("18 18 64 64", 512, coin()),
  // Splash like finlyt.onrender.com: blue coin on off-white (light), white coin on navy (dark).
  "splash-icon-light.png": svg("18 18 64 64", 512, coinColored(BRAND, "#2440E6", TINT, WHITE)),
  "splash-icon-dark.png": svg("18 18 64 64", 512, coinColored(WHITE, TINT, TINT, BRAND)),
  // Android status-bar icon: white silhouette, 96px = 24dp at xxxhdpi.
  "notification-icon.png": svg("14 14 72 72", 96, coinMono(WHITE)),
  "favicon.png": svg("0 0 100 100", 48, `<rect width="100" height="100" rx="24" fill="${BRAND}"/>${coin()}`),
};

for (const [name, source] of Object.entries(assets)) {
  const png = new Resvg(source, { background: "rgba(0,0,0,0)" }).render().asPng();
  fs.writeFileSync(path.join(out, name), png);
  console.log(name, png.length, "bytes");
}

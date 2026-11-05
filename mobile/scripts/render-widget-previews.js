// Renders the pictures Android's widget picker shows for each Finlyt widget, with sample numbers.
// Mirrors src/widgets/widgets.tsx (light theme). Run from mobile/ after changing the widgets:
//   npm i --no-save @resvg/resvg-js && node scripts/render-widget-previews.js
const fs = require("fs");
const path = require("path");
const { Resvg } = require("@resvg/resvg-js");

const OUT = path.join(__dirname, "../assets/widget-preview");
const FONT_DIR = path.join(__dirname, "../node_modules/@expo-google-fonts/geist");
const fontFiles = ["400Regular", "500Medium", "600SemiBold", "700Bold"].map((w) => path.join(FONT_DIR, w, `Geist_${w}.ttf`));

const C = { card: "#FFFFFF", fg: "#0B1033", muted: "#626679", bar: "#F2F2EF", track: "#E5E5E0", brand: "#3355FF" };
const SCALE = 3; // dp → px

function render(name, width, height, body) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width * SCALE}" height="${height * SCALE}" viewBox="0 0 ${width} ${height}" font-family="Geist">${body}</svg>`;
  const png = new Resvg(svg, { font: { fontFiles, loadSystemFonts: true, defaultFontFamily: "Geist" } }).render().asPng();
  fs.writeFileSync(path.join(OUT, `${name}.png`), png);
  console.log(`${name}.png ${width * SCALE}x${height * SCALE}`);
}

const text = (x, y, size, weight, color, s, anchor = "start") =>
  `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${color}" text-anchor="${anchor}">${s}</text>`;

fs.mkdirSync(OUT, { recursive: true });

// Today: ₹1,240 of ₹1,500.
{
  const r = 16;
  const length = 2 * Math.PI * r;
  const arc = (1240 / 1500) * length;
  render(
    "today",
    170,
    170,
    `<rect width="170" height="170" rx="28" fill="${C.card}"/>
     ${text(18, 34, 14, 400, C.muted, "Today")}
     <g transform="translate(112 18)">
       <circle cx="20" cy="20" r="${r}" fill="none" stroke="${C.track}" stroke-width="5"/>
       <circle cx="20" cy="20" r="${r}" fill="none" stroke="${C.brand}" stroke-width="5" stroke-linecap="round"
         stroke-dasharray="${arc} ${length}" transform="rotate(-90 20 20)"/>
     </g>
     ${text(18, 128, 30, 700, C.fg, "₹1,240")}
     ${text(18, 151, 14, 400, C.muted, "of ₹1,500")}`,
  );
}

// Next check-in: 11 PM, 3 to log.
render(
  "checkin",
  170,
  170,
  `<rect width="170" height="170" rx="28" fill="${C.card}"/>
   ${text(18, 34, 14, 400, C.muted, "Next check-in")}
   ${text(18, 128, 30, 700, C.fg, "11 PM")}
   <circle cx="22" cy="146" r="4" fill="${C.brand}"/>
   ${text(33, 151, 14, 400, C.muted, "3 to log")}`,
);

// Log an expense.
render(
  "log",
  340,
  72,
  `<rect width="340" height="72" rx="36" fill="${C.card}"/>
   ${text(24, 42, 17, 400, C.muted, "Log an expense…")}
   <g transform="translate(240 24)" fill="none" stroke="${C.muted}" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">
     <rect x="9" y="2" width="6" height="12" rx="3"/><path d="M19 10v1a7 7 0 0 1-14 0v-1"/><path d="M12 18v4"/>
   </g>
   <circle cx="302" cy="36" r="26" fill="${C.fg}"/>
   <path d="M302 27v18M293 36h18" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round"/>`,
);

// Last 7 days: ₹7,800, today highlighted.
{
  const width = 340;
  const height = 220;
  const pad = 20;
  const inner = width - pad * 2;
  const barsTop = 62;
  const barsHeight = 110;
  const spend = [900, 1500, 2100, 700, 1000, 640, 1240];
  const max = Math.max(...spend);
  const column = inner / 7;
  const barWidth = column * 0.74;
  const bars = spend
    .map((v, i) => {
      const h = Math.max(barsHeight * 0.14, (v / max) * barsHeight);
      const x = pad + i * column + (column - barWidth) / 2;
      return `<rect x="${x}" y="${barsTop + barsHeight - h}" width="${barWidth}" height="${h}" rx="9" fill="${i === 6 ? C.brand : C.bar}"/>`;
    })
    .join("");
  const labels = ["F", "S", "S", "M", "T", "W", "T"]
    .map((l, i) => text(pad + i * column + column / 2, barsTop + barsHeight + 24, 13, i === 6 ? 600 : 400, i === 6 ? C.fg : C.muted, l, "middle"))
    .join("");
  render(
    "week",
    width,
    height,
    `<rect width="${width}" height="${height}" rx="28" fill="${C.card}"/>
     ${text(pad, 40, 14, 400, C.muted, "Last 7 days")}
     ${text(width - pad, 42, 22, 700, C.fg, "₹7,800", "end")}
     ${bars}${labels}`,
  );
}

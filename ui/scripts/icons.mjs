// Generates the reader's home-screen, manifest and favicon files from the one
// master mark, src/assets/brand/favicon.svg (1024×1024, full bleed, square
// corners: platforms round them). Run from ui/ after changing the master:
//
//   node scripts/icons.mjs
//
// It renders with the Playwright Chromium already used by the browser tests,
// writes opaque RGB PNGs (iOS keeps an alpha channel's black), a 32×32 ICO
// with an embedded PNG and the web app manifest into public/ (served at the
// site root by the Crew server), then stamps one content hash as `?v=` on every
// icon and manifest URL in index.html and the manifest, because iOS caches
// home-screen icons aggressively. src/icons.test.ts checks the result.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";
import { chromium } from "playwright";

const ui = fileURLToPath(new URL("..", import.meta.url));
const master = readFileSync(`${ui}src/assets/brand/favicon.svg`, "utf8");
const ink = "#0d1712";

// The maskable icon keeps the mark inside the central 80% circle (radius 410
// of 1024): the mark spans x 192–832, y 156–860 around (512, 508), its farthest
// point 437 from there, so it is scaled by 0.86 and centred on the ink field.
const maskable = master.replace(
  /(<rect width="1024" height="1024" fill="#0d1712"\/>)([\s\S]*)(<\/svg>)/,
  (_, bg, mark, end) =>
    `${bg}\n  <g transform="translate(512 512) scale(0.86) translate(-512 -508)">${mark}</g>\n${end}`,
);
if (maskable === master) throw new Error("master no longer starts with the full-bleed ink rect");

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
};

// png encodes RGBA pixels as RGB (colour type 2) or RGBA (6), filter 0.
function png(size, rgba, alpha) {
  const channels = alpha ? 4 : 3;
  const raw = Buffer.alloc(size * (size * channels + 1));
  for (let y = 0; y < size; y++) {
    const row = y * (size * channels + 1);
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      for (let c = 0; c < channels; c++) raw[row + 1 + x * channels + c] = rgba[i + c];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = alpha ? 6 : 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ico wraps one PNG (Windows Vista and later, every current browser).
function ico(size, pngData) {
  const head = Buffer.alloc(22);
  head.writeUInt16LE(1, 2); // icon
  head.writeUInt16LE(1, 4); // one image
  head[6] = size;
  head[7] = size;
  head.writeUInt16LE(1, 10); // planes
  head.writeUInt16LE(32, 12); // bits per pixel
  head.writeUInt32LE(pngData.length, 14);
  head.writeUInt32LE(22, 18);
  return Buffer.concat([head, pngData]);
}

const browser = await chromium.launch();
const page = await browser.newPage();
async function render(svg, size) {
  const pixels = await page.evaluate(
    async ({ svg, size }) => {
      const img = new Image();
      img.src = `data:image/svg+xml;base64,${btoa(svg)}`;
      await img.decode();
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, size, size);
      return Array.from(ctx.getImageData(0, 0, size, size).data);
    },
    { svg, size },
  );
  for (let i = 3; i < pixels.length; i += 4)
    if (pixels[i] !== 255) throw new Error(`master is not opaque at ${size}px`);
  return Uint8Array.from(pixels);
}

const files = {
  "apple-touch-icon.png": png(180, await render(master, 180), false),
  "icon-192.png": png(192, await render(master, 192), false),
  "icon-512.png": png(512, await render(master, 512), false),
  "icon-maskable-512.png": png(512, await render(maskable, 512), false),
  "favicon.ico": ico(32, png(32, await render(master, 32), true)),
};
await browser.close();

const hash = createHash("sha256");
for (const name of Object.keys(files).sort()) hash.update(name).update(files[name]);
const v = hash.digest("hex").slice(0, 10);

const icon = (src, size, purpose) => ({ src: `/${src}?v=${v}`, sizes: `${size}x${size}`, type: "image/png", purpose });
files["manifest.webmanifest"] = Buffer.from(
  `${JSON.stringify(
    {
      name: "Crew",
      short_name: "Crew",
      description: "PocketContext Crew: notes, tasks and human review for your agents.",
      start_url: "/",
      scope: "/",
      display: "standalone",
      background_color: ink,
      theme_color: ink,
      icons: [
        icon("icon-192.png", 192, "any"),
        icon("icon-512.png", 512, "any"),
        icon("icon-maskable-512.png", 512, "maskable"),
      ],
    },
    null,
    2,
  )}\n`,
);
for (const [name, data] of Object.entries(files)) writeFileSync(`${ui}public/${name}`, data);

const indexPath = `${ui}index.html`;
const index = readFileSync(indexPath, "utf8");
const stamped = index.replace(
  /(href="\/(?:apple-touch-icon\.png|favicon\.ico|manifest\.webmanifest))(?:\?v=[0-9a-f]*)?"/g,
  `$1?v=${v}"`,
);
if ((stamped.match(new RegExp(`\\?v=${v}"`, "g")) ?? []).length !== 3)
  throw new Error("index.html must link /apple-touch-icon.png, /favicon.ico and /manifest.webmanifest");
writeFileSync(indexPath, stamped);
console.log(`icons written, v=${v}`);

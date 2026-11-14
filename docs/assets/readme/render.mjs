// Renders the README images from readme.html (next to this file) into PNGs here.
//
// Needs Playwright and the IBM Plex fonts of pocketcontext-website. Run it from a
// pocketcontext-website checkout so both resolve from the working directory:
//
//   cd ../pocketcontext-website
//   node ../pocketcontext-crew/docs/assets/readme/render.mjs
//
// Each [data-shot] element becomes <data-shot>-<theme>.png for every theme in
// data-themes ("dark", "light"), or <data-shot>.png for data-themes="any"
// (transparent background). Images are drawn at 2x for elements narrower than
// 800px, so small buttons stay sharp; large shots are captured at 1x.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cwd = process.cwd();
const { chromium } = createRequire(join(cwd, 'package.json'))('@playwright/test');
const fonts = resolve(cwd, 'public/fonts');
const face = (family, file, weight) =>
  `@font-face{font-family:${family};font-weight:${weight};src:url(data:font/woff2;base64,${readFileSync(join(fonts, file)).toString('base64')}) format('woff2')}`;
const fontCss = [
  face('Plex', 'ibm-plex-sans-400-latin.woff2', 400),
  face('Plex', 'ibm-plex-sans-700-latin.woff2', 700),
  face('Mono', 'ibm-plex-mono-400-latin.woff2', 400),
].join('\n');

const browser = await chromium.launch();
try {
  for (const scale of [1, 2]) {
    const page = await browser.newPage({ viewport: { width: 1800, height: 1000 }, deviceScaleFactor: scale });
    await page.goto(pathToFileURL(join(here, 'readme.html')).href);
    await page.addStyleTag({ content: fontCss });
    await page.evaluate(() => document.fonts.ready);
    const shots = await page.$$eval('[data-shot]', nodes => nodes.map(n => ({
      name: n.dataset.shot, themes: n.dataset.themes.split(' '), width: n.getBoundingClientRect().width,
    })));
    for (const { name, themes, width } of shots) {
      if ((width < 800 ? 2 : 1) !== scale) continue;
      for (const theme of themes) {
        await page.evaluate(t => { document.body.className = t === 'light' ? 'light' : ''; }, theme);
        await page.evaluate(t => { document.body.style.background = t === 'any' ? 'transparent' : '#888'; }, theme);
        const file = join(here, theme === 'any' ? `${name}.png` : `${name}-${theme}.png`);
        await page.locator(`[data-shot="${name}"]`).screenshot({ path: file, omitBackground: theme === 'any' });
        console.log(file);
      }
    }
    await page.close();
  }
} finally {
  await browser.close();
}

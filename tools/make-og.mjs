// Membuat ulang og-image.jpg (1200×630) dan icon.png (512×512) di root repo.
// Cara pakai (dari root repo):
//   npm i --no-save playwright && npx playwright install chromium
//   node tools/make-og.mjs
// Langkah: (1) logo diambil dari data URI <img id="logoHeader"> → tools/logo.webp,
// (2) kotak 3D dipotret dari index.html (latar transparan) → tools/build/box.png,
// (3) tools/og.html dipotret menjadi og-image.jpg dan icon.png.
import { chromium } from "playwright";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOOLS = path.join(ROOT, "tools");
fs.mkdirSync(path.join(TOOLS, "build"), { recursive: true });

// 1) logo dari data URI
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const m = html.match(/id="logoHeader" src="data:image\/(\w+);base64,([^"]+)"/);
if (!m) throw new Error("Logo data URI tidak ditemukan di index.html");
fs.writeFileSync(path.join(TOOLS, "logo.webp"), Buffer.from(m[2], "base64"));

// server statis kecil untuk root repo
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".png": "image/png", ".webp": "image/webp", ".jpg": "image/jpeg" };
const server = http.createServer((req, res) => {
  const f = path.join(ROOT, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TYPES[path.extname(f)] || "application/octet-stream" });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
try {
  // 2) potret kotak 3D: reduced-motion → tanpa auto-rotate, animasi langsung selesai
  const p1 = await browser.newPage({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 1, reducedMotion: "reduce" });
  await p1.addInitScript(() => { try { localStorage.setItem("cumilHint", "1"); } catch (e) {} });
  await p1.goto(`${BASE}/index.html`, { waitUntil: "networkidle" });
  await p1.evaluate(() => document.fonts.ready);
  await p1.addStyleTag({ content: `
    html,body{background:transparent !important}
    header.top,.panel,.order-bar,.stage-badge,.hint,.loading,#confetti,.toast{display:none !important}
    .app{display:block !important}
    .stage{position:fixed !important;inset:0 !important;height:auto !important;background:transparent !important;box-shadow:none !important;border-radius:0 !important}` });
  // bumbu contoh supaya taburan terlihat
  await p1.evaluate(() => {
    state.manis.bumbu = "cokelat"; state.gurih.bumbu = "balado"; state.gurih.pedas = 2;
    scene3d.setBumbu("manis", true); scene3d.setBumbu("gurih", true); scene3d.redrawLabels();
  });
  await p1.waitForTimeout(2500);
  await p1.locator(".stage").screenshot({ path: path.join(TOOLS, "build", "box.png"), omitBackground: true });

  // 3) og-image.jpg & icon.png
  const p2 = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await p2.goto(`${BASE}/tools/og.html`, { waitUntil: "networkidle" });
  await p2.evaluate(() => Promise.all([document.fonts.ready, window.ogReady]));
  await p2.locator("#og").screenshot({ path: path.join(ROOT, "og-image.jpg"), type: "jpeg", quality: 85 });
  await p2.locator("#icon").screenshot({ path: path.join(ROOT, "icon.png") });
} finally {
  await browser.close();
  server.close();
}
for (const f of ["og-image.jpg", "icon.png"]) console.log(f, Math.round(fs.statSync(path.join(ROOT, f)).size / 1024) + " KB");

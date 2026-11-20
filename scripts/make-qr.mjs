#!/usr/bin/env node
// Genera in qr/ i QR code e i cartellini stampabili delle macchinette.
//
// Uso:   node scripts/make-qr.mjs [indirizzo-base] [--style square|rounded] [--senza-classifica]
// Es.:   node scripts/make-qr.mjs https://TUOUTENTE.github.io/mokatvisor/ --style square
//
// L'indirizzo di ogni macchinetta è <indirizzo-base>?m=<id>; in più c'è un cartellino «Classifica» (<indirizzo-base>classifica.html,
// escluso con --senza-classifica). Le macchinette (id, nome, piano, ordine) vengono da machines.js, lo stesso file del sito. Prima di scrivere qualsiasi file ogni QR viene riletto con un decoder
// indipendente (jsQR) a piena risoluzione, a 200 px e a 200 px sfocato: se anche uno solo fallisce, lo script
// si ferma con errore. Lo stile "rounded" (default) è accettato solo se supera la verifica, altrimenti si usa "square".
import { mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { MACHINES, HOME_ORDER } from "../machines.js";
import { qrSvg, qrPng, verifyQr, totalModules } from "./qr-lib.mjs";

const require = createRequire(import.meta.url);
const { PNG } = require("pngjs");
const jsQR = require("jsqr");

const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "qr");
const DEFAULT_BASE = "https://eskilkofler.github.io/mokatvisor/";
const AMBER = "#F5A524"; // le stelle (stesso ambra del sito)

function fail(msg) {
  console.error(`Errore: ${msg}`);
  process.exit(1);
}

/* ------------------------------ Argomenti ------------------------------ */

function parseArgs(argv) {
  let style = "rounded";
  let classifica = true;
  let base;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--style") style = argv[++i];
    else if (a.startsWith("--style=")) style = a.slice("--style=".length);
    else if (a === "--senza-classifica") classifica = false;
    else if (a.startsWith("--")) fail(`opzione sconosciuta: ${a}`);
    else base ??= a;
  }
  if (style !== "square" && style !== "rounded") fail('--style deve essere "square" oppure "rounded"');
  return { style, classifica, base: parseBase(base) };
}

function parseBase(arg = DEFAULT_BASE) {
  let u;
  try { u = new URL(arg); } catch { fail(`indirizzo non valido: "${arg}"`); }
  if (u.protocol !== "https:" && u.protocol !== "http:") fail("l'indirizzo deve iniziare con https://");
  u.search = "";
  u.hash = "";
  // Una cartella deve finire con "/", un file (es. index.html) resta com'è.
  if (!u.pathname.endsWith("/") && !path.posix.basename(u.pathname).includes(".")) u.pathname += "/";
  const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|\.local$/.test(u.hostname);
  if (local || u.protocol !== "https:") {
    console.warn("⚠ Indirizzo locale o non https: va bene per provare, NON stampare questi QR.\n");
  }
  return u;
}

const machineUrl = (base, id) => {
  const u = new URL(base);
  u.searchParams.set("m", id);
  return u.toString();
};

// Titoli del cartellino a partire dai nomi del sito, senza la parola «Macchinetta» e senza ripetizioni:
//   «4° piano» (piccolo) + «Torretta secondaria»; «Brambillino» (piccolo) + «Primo piano»; «Terzo piano» (senza riga piccola)
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
function titlesOf(m) {
  let title = m.name.replace(/^Macchinetta\s+/, "");
  let small = m.floor ?? "";
  const brand = /^(\S+)\s+(.+)$/.exec(title)?.[1];
  if (small && brand && small.startsWith(`${brand} `)) { // «Brambillino» + «Primo piano»
    small = brand;
    title = title.slice(brand.length + 1);
  }
  title = capitalize(title.replace(/^del\s+/, ""));
  if (small !== brand && /piano$/i.test(small) && /piano$/i.test(title)) small = ""; // «3° piano» + «Terzo piano» sarebbe una ripetizione
  return { title, small };
}

// I cartellini nell'ordine della home, più «Classifica»
function itemsOf(base, withClassifica) {
  const rank = (m) => { const i = HOME_ORDER.indexOf(m.id); return i < 0 ? HOME_ORDER.length : i; };
  const items = [...MACHINES].sort((a, b) => rank(a) - rank(b)).map((m) => ({
    id: m.id, url: machineUrl(base, m.id), ...titlesOf(m), text: "Hai preso una bevanda? Scansiona e dai le stelle!",
  }));
  if (withClassifica) {
    items.push({
      id: "classifica", url: new URL("classifica.html", base).toString(), title: "Classifica", small: "",
      text: "Chi fa le bevande migliori? Guarda la classifica!",
    });
  }
  return items;
}

/* ------------------------- QR di ogni macchinetta ------------------------ */

// Genera il QR di una macchinetta in uno stile e lo verifica
function buildQr(url, style) {
  const svg = qrSvg(url, style);
  const { png, width } = qrPng(svg, 1200);
  return { style, svg, png, width, problems: verifyQr(svg, url, width) };
}

/* ------------------------------ Cartellini ------------------------------ */

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Geometria del foglio (mm): A4 verticale con 8 mm di margine di sicurezza; l'area utile è 194 × 281 mm,
// divisa in 2 colonne × 4 righe di cartellini orizzontali da 97 × 70,25 mm.
export const SHEET = { page: [210, 297], margin: 8, cols: 2, rows: 4, cell: [97, 70.25], pad: 4, qr: 54, gap: 3.5 };
const SLOTS = SHEET.cols * SHEET.rows;

// Un cartellino orizzontale: QR a sinistra, a destra marchio e stelle, titolo, invito e nota
function ticketHtml({ item, svg }) {
  return `
    <article class="ticket">
      <div class="qr" role="img" aria-label="QR code: ${esc(item.title)}">${svg}</div>
      <div class="info">
        <header class="head">
          <b>Mokatvisor</b>
          <span class="sub"><i>ISILTeP</i><em aria-hidden="true">★★★★★</em></span>
        </header>
        <div class="names">
          ${item.small ? `<p class="small">${esc(item.small)}</p>` : ""}
          <h2>${esc(item.title)}</h2>
        </div>
        <div class="foot">
          <p class="cta">${esc(item.text)}</p>
          <p class="note">Un gioco fatto da studenti, per studenti: solo per divertirsi.</p>
        </div>
      </div>
    </article>`;
}

// Un solo foglio A4: 8 slot (gli slot senza cartellino restano vuoti). Linee di taglio tratteggiate fra i cartellini, fino ai
// bordi dell'area utile, e piccole tacche agli angoli.
function cartelliniHtml(cards) {
  const { margin, cols, cell, pad, qr, gap } = SHEET;
  const slots = Array.from({ length: SLOTS }, (_, i) => (cards[i] ? ticketHtml(cards[i]) : '<div class="ticket empty"></div>'));
  return `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mokatvisor · cartellini</title>
  <style>
    /* Le stampanti di casa non stampano fino al bordo: margine di sicurezza di ${margin} mm e area utile 194 × 281 mm */
    @page { size: A4 portrait; margin: ${margin}mm; }
    * { box-sizing: border-box; }
    html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { margin: 0; background: #e6e6e6; color: #111; font: 8.5pt/1.2 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif; }
    .sheet { position: relative; width: ${cols * cell[0]}mm; height: ${SHEET.rows * cell[1]}mm; background: #fff;
             display: grid; grid-template-columns: repeat(${cols}, ${cell[0]}mm); grid-template-rows: repeat(${SHEET.rows}, ${cell[1]}mm); overflow: hidden; }
    .ticket { position: relative; padding: ${pad}mm; display: grid; grid-template-columns: ${qr}mm 1fr; column-gap: ${gap}mm; overflow: hidden;
              border: 0 dashed #8c8c8c; }
    /* Linee di taglio: fra le colonne e fra le righe, fino al bordo dell'area utile */
    .ticket:nth-child(odd) { border-right-width: .25mm; }
    .ticket:nth-child(-n+${SLOTS - cols}) { border-bottom-width: .25mm; }
    .ticket p, .ticket h2 { margin: 0; }
    .qr { width: ${qr}mm; height: ${qr}mm; align-self: center; }
    .qr svg { display: block; width: 100%; height: 100%; }
    .info { display: flex; flex-direction: column; justify-content: space-between; min-width: 0; }
    .head b { display: block; font-size: 12.5pt; font-weight: 700; letter-spacing: -.03em; line-height: 1.05; }
    .sub { display: flex; align-items: baseline; justify-content: space-between; margin-top: .6mm; }
    .sub i { font-style: normal; font-size: 7pt; font-weight: 600; letter-spacing: .06em; color: #666; }
    .sub em { font-style: normal; font-size: 8.5pt; letter-spacing: .04em; color: #F5A524; white-space: nowrap; }
    .small { font-size: 7pt; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #666; margin-bottom: .8mm !important; }
    h2 { font-size: 15.5pt; font-weight: 700; line-height: 1.08; letter-spacing: -.02em; overflow-wrap: anywhere; }
    .cta { font-size: 8.5pt; font-weight: 700; line-height: 1.2; }
    .note { margin-top: 1.6mm !important; font-size: 7pt; line-height: 1.25; color: #666; }
    /* Tacche agli angoli dell'area utile */
    .tick { position: absolute; background: #8c8c8c; z-index: 2; }
    .tick.h { width: 3mm; height: .25mm; } .tick.v { width: .25mm; height: 3mm; }
    .tl { top: 0; left: 0; } .tr { top: 0; right: 0; } .bl { bottom: 0; left: 0; } .br { bottom: 0; right: 0; }
    @media screen { .sheet { margin: ${margin}mm auto; box-shadow: 0 2px 10px rgba(0,0,0,.25); } }
    @media print { body { background: #fff; } .sheet { margin: 0; } }
  </style>
</head>
<body>
  <main class="sheet">${slots.join("\n")}
    ${["tl", "tr", "bl", "br"].map((c) => `<i class="tick h ${c}"></i><i class="tick v ${c}"></i>`).join("")}
  </main>
</body>
</html>
`;
}

/* ------------------------------ PDF e controllo ------------------------------ */

// Su macOS si usa WebKit (il motore di Safari) tramite scripts/html-to-pdf.swift: crea il PDF e un PNG a 300 dpi della pagina.
// Altrove, se c'è Chrome/Chromium/Edge/Brave (o CHROME_BIN), si crea solo il PDF.
const DPI = 300;
const SWIFT_SRC = fileURLToPath(new URL("./html-to-pdf.swift", import.meta.url));

function webkitTool() {
  if (process.platform !== "darwin" || spawnSync("xcrun", ["--find", "swiftc"], { stdio: "ignore" }).status !== 0) return null;
  const dir = path.join(os.tmpdir(), "mokatvisor-tools"); // (il nome del file non deve coincidere con una cartella di WebKit in tmp)
  mkdirSync(dir, { recursive: true });
  const bin = path.join(dir, "html-to-pdf");
  if (!existsSync(bin)) {
    console.log("… compilo lo strumento PDF (una volta sola)");
    if (spawnSync("swiftc", ["-O", SWIFT_SRC, "-o", bin], { stdio: "inherit" }).status !== 0) return null;
  }
  return bin;
}

function findChrome() {
  const candidates = [
    process.env.CHROME_BIN,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser",
  ];
  return candidates.find((p) => p && existsSync(p)) ?? null;
}

// Crea il PDF (una pagina) e, se possibile, il PNG della pagina a 300 dpi. Ritorna { pdf, png } (percorso o null).
function renderSheet(htmlPath, pdfPath) {
  const pngPath = path.join(os.tmpdir(), "mokatvisor-cartellini.png");
  const tool = webkitTool();
  if (tool) {
    const r = spawnSync(tool, [htmlPath, pdfPath, pngPath, String(DPI)], { stdio: "inherit", timeout: 90_000 });
    if (r.status === 0 && existsSync(pdfPath) && existsSync(pngPath)) return { pdf: pdfPath, png: pngPath };
  }
  const chrome = findChrome();
  if (chrome) {
    const r = spawnSync(chrome, ["--headless", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${pdfPath}`, pathToFileURL(htmlPath).href],
      { stdio: "ignore", timeout: 60_000 });
    if (r.status === 0 && existsSync(pdfPath)) return { pdf: pdfPath, png: null };
  }
  return { pdf: null, png: null };
}

// Controllo sul foglio reso a 300 dpi: ritaglia ogni QR, lo decodifica (jsQR) e misura quanto è grande sulla carta.
// Ritorna l'elenco dei problemi (vuoto = tutto bene) e le misure.
function verifySheet(pngPath, cards) {
  const img = PNG.sync.read(readFileSync(pngPath));
  const px = (mm) => (mm * DPI) / 25.4;
  const { margin, cols, cell, pad, qr } = SHEET;
  const problems = [], sizes = [];
  cards.forEach((c, i) => {
    const col = i % cols, row = Math.floor(i / cols);
    const x0 = margin + col * cell[0] + pad, y0 = margin + row * cell[1] + (cell[1] - qr) / 2; // angolo del QR (mm)
    const cx = Math.round(px(x0 - 2)), cy = Math.round(px(y0 - 2)), cw = Math.round(px(qr + 4));
    const crop = new Uint8ClampedArray(cw * cw * 4);
    let minX = cw, minY = cw, maxX = -1, maxY = -1;
    for (let y = 0; y < cw; y++) {
      for (let x = 0; x < cw; x++) {
        const s = ((cy + y) * img.width + (cx + x)) * 4, d = (y * cw + x) * 4;
        crop.set(img.data.subarray(s, s + 4), d);
        if (img.data[s] < 128) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      }
    }
    const read = jsQR(crop, cw, cw)?.data ?? null;
    if (read !== c.item.url) problems.push(`${c.item.id}: letto ${read === null ? "niente" : `"${read}"`} (atteso "${c.item.url}")`);
    // Misura: il disegno nero occupa N moduli; il QR con il margine ne occupa N + 8
    const n = totalModules(c.svg) - 8;
    const modMm = ((maxX - minX + 1) / n) * 25.4 / DPI;
    const sizeMm = modMm * (n + 8);
    sizes.push(sizeMm);
    if (sizeMm < 45) problems.push(`${c.item.id}: il QR misura ${sizeMm.toFixed(1)} mm (minimo 45 mm)`);
  });
  return { problems, sizes };
}

/* --------------------------------- Main --------------------------------- */

const { style, base, classifica } = parseArgs(process.argv.slice(2));
const items = itemsOf(base, classifica);

// 1) Genero e verifico TUTTI i QR prima di scrivere qualsiasi file. Lo stile è uno solo per tutti i cartellini:
//    se anche un solo QR arrotondato non supera la verifica, uso quello quadrato per tutti.
const buildAll = (st) => items.map((item) => ({ item, ...buildQr(item.url, st) }));
let built = buildAll(style);
if (style === "rounded" && built.some((b) => b.problems.length)) {
  for (const b of built.filter((x) => x.problems.length)) {
    console.warn(`⚠ ${b.item.id}: lo stile arrotondato non supera la verifica (${b.problems.join("; ")})`);
  }
  console.warn("⚠ uso lo stile quadrato per tutti i QR\n");
  built = buildAll("square");
}
const failed = built.filter((b) => b.problems.length);
if (failed.length) {
  for (const b of failed) console.error(`✘ ${b.item.id}: ${b.problems.join("; ")}`);
  fail(`${failed.length} QR non decodificabili: non ho scritto nessun file`);
}

// 2) File: <id>.svg (solo QR), <id>.png (>= 1200 px), cartellini.html (+ cartellini.pdf se c'è un browser)
await mkdir(OUT_DIR, { recursive: true });
await rm(path.join(OUT_DIR, "stampa.html"), { force: true }); // vecchio foglio, sostituito da cartellini.html
if (!classifica) for (const ext of ["svg", "png"]) await rm(path.join(OUT_DIR, `classifica.${ext}`), { force: true });
for (const b of built) {
  await writeFile(path.join(OUT_DIR, `${b.item.id}.svg`), b.svg);
  await writeFile(path.join(OUT_DIR, `${b.item.id}.png`), b.png);
  console.log(`✔ ${b.item.id.padEnd(20)} ${b.style.padEnd(7)} ${b.width} px  ${b.item.url}`);
}
const htmlPath = path.join(OUT_DIR, "cartellini.html");
await writeFile(htmlPath, cartelliniHtml(built));
console.log(`✔ cartellini.html     un foglio A4, ${built.length} cartellini su ${SLOTS} slot (margine ${SHEET.margin} mm)`);

const pdfPath = path.join(OUT_DIR, "cartellini.pdf");
await rm(pdfPath, { force: true });
const sheet = renderSheet(htmlPath, pdfPath);
if (sheet.pdf) console.log("✔ cartellini.pdf      una pagina A4");
else console.log("• cartellini.pdf non creato: nessun renderer trovato (su macOS serve Xcode; altrove Chrome/Chromium/Edge/Brave o CHROME_BIN). Stampa cartellini.html dal browser.");

if (sheet.png) {
  const { problems, sizes } = verifySheet(sheet.png, built);
  await rm(sheet.png, { force: true });
  if (problems.length) {
    for (const p of problems) console.error(`✘ ${p}`);
    fail("controllo del foglio a 300 dpi fallito (i file sono stati scritti, ma NON stampare questo foglio)");
  }
  console.log(`✔ Foglio a ${DPI} dpi: ${built.length} QR letti e confrontati; misura del QR sulla carta ${Math.min(...sizes).toFixed(1)}–${Math.max(...sizes).toFixed(1)} mm (minimo 45)`);
} else {
  console.warn("⚠ Il foglio reso non è stato controllato a 300 dpi: serve macOS con Xcode (WebKit). Scansiona a mano ogni cartellino stampato.");
}

console.log(`\n✔ Verifica: ${built.length} QR su ${built.length} decodificati (piena risoluzione, 200 px, 200 px sfocato).`);
console.log(`File generati in ${path.relative(process.cwd(), OUT_DIR) || "."}/`);

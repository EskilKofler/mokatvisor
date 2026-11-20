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
import { existsSync, readFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
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

// Geometria (mm): pagine A4 verticali con 8 mm di margine di sicurezza (le stampanti di casa non stampano fino al bordo).
// L'area utile è 194 × 281 mm, divisa in 2 colonne × 2 righe di cartellini A6 verticali da 97 × 140,5 mm.
export const SHEET = { page: [210, 297], margin: 8, cols: 2, rows: 2, cell: [97, 140.5], pad: 5, qr: 70 };
export const PER_PAGE = SHEET.cols * SHEET.rows;
export const MIN_QR_MM = 62;

// Un cartellino verticale, in colonna centrata. Cinque gruppi distribuiti in modo uniforme (flex, space-between):
// marchio, nome (altezza di due righe riservata), QR, stelle + invito, nota. Così marchio e QR stanno sempre negli stessi punti.
function ticketHtml({ item, svg }) {
  return `
    <article class="ticket">
      <header class="brand"><b>Mokatvisor</b><span>ISILTeP</span></header>
      <div class="names">
        ${item.small ? `<p class="small">${esc(item.small)}</p>` : ""}
        <h2>${esc(item.title)}</h2>
      </div>
      <div class="qr" role="img" aria-label="QR code: ${esc(item.title)}">${svg}</div>
      <div class="invite">
        <p class="stars" aria-hidden="true">★★★★★</p>
        <p class="cta">${esc(item.text)}</p>
      </div>
      <p class="note">Un gioco fatto da studenti, per studenti: solo per divertirsi.</p>
    </article>`;
}

// Pagine A4 da 4 cartellini (2 × 2). Linee di taglio tratteggiate fra i cartellini, fino ai bordi dell'area utile,
// e piccole tacche agli angoli. Gli slot senza cartellino restano vuoti.
function cartelliniHtml(cards) {
  const { margin, cols, cell, pad, qr } = SHEET;
  const pages = [];
  for (let i = 0; i < cards.length; i += PER_PAGE) {
    const slots = Array.from({ length: PER_PAGE }, (_, k) => (cards[i + k] ? ticketHtml(cards[i + k]) : '<div class="ticket empty"></div>'));
    pages.push(`  <main class="sheet">${slots.join("\n")}
    ${["tl", "tr", "bl", "br"].map((c) => `<i class="tick h ${c}"></i><i class="tick v ${c}"></i>`).join("")}
  </main>`);
  }
  return `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mokatvisor · cartellini</title>
  <style>
    /* Margine di sicurezza di ${margin} mm: l'area utile di ogni pagina è 194 × 281 mm */
    @page { size: A4 portrait; margin: ${margin}mm; }
    * { box-sizing: border-box; }
    html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { margin: 0; background: #e6e6e6; color: #111; font: 8pt/1.2 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif; }
    .sheet { position: relative; width: ${cols * cell[0]}mm; height: ${SHEET.rows * cell[1]}mm; background: #fff;
             display: grid; grid-template-columns: repeat(${cols}, ${cell[0]}mm); grid-template-rows: repeat(${SHEET.rows}, ${cell[1]}mm); overflow: hidden; }
    .ticket { position: relative; padding: ${pad}mm; display: flex; flex-direction: column; align-items: center; justify-content: space-between;
              text-align: center; overflow: hidden; border: 0 dashed #8c8c8c; break-inside: avoid; page-break-inside: avoid; }
    /* Linee di taglio: fra le colonne e fra le righe, fino al bordo dell'area utile */
    .ticket:nth-child(odd) { border-right-width: .25mm; }
    .ticket:nth-child(-n+${PER_PAGE - cols}) { border-bottom-width: .25mm; }
    .ticket p, .ticket h2 { margin: 0; }
    .brand { display: flex; flex-direction: column; align-items: center; }
    .brand b { font-size: 19pt; font-weight: 700; letter-spacing: -.03em; line-height: 1.05; }
    .brand span { font-size: 8pt; font-weight: 600; letter-spacing: .08em; color: #666; }
    /* Il nome occupa sempre l'altezza di una riga piccola + due righe di titolo, anche se il titolo ne ha una */
    .names { height: 21mm; width: 100%; display: flex; flex-direction: column; justify-content: center; }
    .small { font-size: 8pt; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: #666; margin-bottom: .8mm !important; }
    h2 { font-size: 21pt; font-weight: 700; line-height: 1.08; letter-spacing: -.02em; overflow-wrap: anywhere; }
    .qr { width: ${qr}mm; height: ${qr}mm; flex: none; }
    .qr svg { display: block; width: 100%; height: 100%; }
    .invite { display: flex; flex-direction: column; align-items: center; gap: .8mm; }
    .stars { font-size: 13pt; letter-spacing: .08em; line-height: 1; color: #F5A524; }
    .cta { font-size: 11pt; font-weight: 700; line-height: 1.2; max-width: 80mm; }
    .note { font-size: 8pt; line-height: 1.25; color: #666; max-width: 80mm; }
    /* Tacche agli angoli dell'area utile */
    .tick { position: absolute; background: #8c8c8c; z-index: 2; }
    .tick.h { width: 3mm; height: .25mm; } .tick.v { width: .25mm; height: 3mm; }
    .tl { top: 0; left: 0; } .tr { top: 0; right: 0; } .bl { bottom: 0; left: 0; } .br { bottom: 0; right: 0; }
    @media screen { .sheet { margin: ${margin}mm auto; box-shadow: 0 2px 10px rgba(0,0,0,.25); } }
    @media print { body { background: #fff; } .sheet { margin: 0; break-after: page; page-break-after: always; } .sheet:last-child { break-after: auto; page-break-after: auto; } }
  </style>
</head>
<body>
${pages.join("\n")}
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

// Crea il PDF (una pagina A4 ogni 4 cartellini) e, su macOS, i PNG delle pagine a 300 dpi con le posizioni dei QR.
// Ritorna { pdf, pngs, layout } (percorsi, o null se non disponibili).
function renderSheet(htmlPath, pdfPath) {
  const prefix = path.join(os.tmpdir(), "mokatvisor-cartellini");
  const layoutPath = `${prefix}.json`;
  const tool = webkitTool();
  if (tool) {
    for (const f of readdirSync(os.tmpdir()).filter((f) => f.startsWith("mokatvisor-cartellini-"))) rmSync(path.join(os.tmpdir(), f), { force: true });
    const r = spawnSync(tool, [htmlPath, pdfPath, prefix, String(DPI), layoutPath], { stdio: "inherit", timeout: 90_000 });
    if (r.status === 0 && existsSync(pdfPath) && existsSync(layoutPath)) {
      const pngs = readdirSync(os.tmpdir()).filter((f) => /^mokatvisor-cartellini-\d+\.png$/.test(f)).sort().map((f) => path.join(os.tmpdir(), f));
      return { pdf: pdfPath, pngs, layout: layoutPath };
    }
  }
  const chrome = findChrome();
  if (chrome) {
    const r = spawnSync(chrome, ["--headless", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${pdfPath}`, pathToFileURL(htmlPath).href],
      { stdio: "ignore", timeout: 60_000 });
    if (r.status === 0 && existsSync(pdfPath)) return { pdf: pdfPath, pngs: [], layout: null };
  }
  return { pdf: null, pngs: [], layout: null };
}

// Controllo sulle pagine rese a 300 dpi: ritaglia ogni QR (nella posizione misurata sulla pagina vera), lo decodifica (jsQR)
// e misura quanto è grande sulla carta. Ritorna l'elenco dei problemi (vuoto = tutto bene) e le misure.
function verifySheet(sheet, cards) {
  const pages = sheet.pngs.map((p) => PNG.sync.read(readFileSync(p)));
  const boxes = JSON.parse(readFileSync(sheet.layout, "utf8"));
  const px = (mm) => (mm * DPI) / 25.4;
  const problems = [], sizes = [];
  if (boxes.length !== cards.length) problems.push(`trovati ${boxes.length} QR nel foglio, attesi ${cards.length}`);
  cards.forEach((c, i) => {
    const box = boxes[i], img = pages[(box?.page ?? 1) - 1];
    if (!box || !img) { problems.push(`${c.item.id}: QR non trovato nel foglio`); return; }
    if (box.w < MIN_QR_MM) problems.push(`${c.item.id}: il QR nel foglio misura ${box.w.toFixed(1)} mm (minimo ${MIN_QR_MM} mm)`);
    const cx = Math.round(px(box.x - 2)), cy = Math.round(px(box.y - 2)), cw = Math.round(px(box.w + 4));
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
    // Misura sulla pagina resa: il disegno nero occupa N moduli; il QR con il margine ne occupa N + 8
    const n = totalModules(c.svg) - 8;
    const sizeMm = (((maxX - minX + 1) / n) * (n + 8) * 25.4) / DPI;
    sizes.push(sizeMm);
    if (sizeMm < MIN_QR_MM) problems.push(`${c.item.id}: il QR stampato misura ${sizeMm.toFixed(1)} mm (minimo ${MIN_QR_MM} mm)`);
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
console.log(`✔ cartellini.html     ${Math.ceil(built.length / PER_PAGE)} pagine A4, ${built.length} cartellini A6 (2×2, margine ${SHEET.margin} mm)`);

const pdfPath = path.join(OUT_DIR, "cartellini.pdf");
await rm(pdfPath, { force: true });
const sheet = renderSheet(htmlPath, pdfPath);
if (sheet.pdf) console.log(`✔ cartellini.pdf      ${Math.ceil(built.length / PER_PAGE)} pagine A4`);
else console.log("• cartellini.pdf non creato: nessun renderer trovato (su macOS serve Xcode; altrove Chrome/Chromium/Edge/Brave o CHROME_BIN). Stampa cartellini.html dal browser.");

if (sheet.pngs.length && sheet.layout) {
  const { problems, sizes } = verifySheet(sheet, built);
  for (const f of sheet.pngs) await rm(f, { force: true });
  await rm(sheet.layout, { force: true });
  if (problems.length) {
    for (const p of problems) console.error(`✘ ${p}`);
    fail("controllo delle pagine a 300 dpi fallito (i file sono stati scritti, ma NON stampare questi fogli)");
  }
  console.log(`✔ Pagine a ${DPI} dpi: ${built.length} QR letti e confrontati; misura del QR sulla carta ${Math.min(...sizes).toFixed(1)}–${Math.max(...sizes).toFixed(1)} mm (minimo ${MIN_QR_MM})`);
} else {
  console.warn("⚠ Le pagine rese non sono state controllate a 300 dpi: serve macOS con Xcode (WebKit). Scansiona a mano ogni cartellino stampato.");
}

console.log(`\n✔ Verifica: ${built.length} QR su ${built.length} decodificati (piena risoluzione, 200 px, 200 px sfocato).`);
console.log(`File generati in ${path.relative(process.cwd(), OUT_DIR) || "."}/`);

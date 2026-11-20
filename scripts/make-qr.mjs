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
    id: m.id, url: machineUrl(base, m.id), ...titlesOf(m), text: "Scansionami e valuta la tua bevanda!",
  }));
  if (withClassifica) {
    items.push({
      id: "classifica", url: new URL("classifica.html", base).toString(), title: "Classifica", small: "",
      text: "Scansionami e guarda la classifica!",
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
// Area utile 194 × 281 mm: 2 colonne × 3 righe di "slot". Ogni slot contiene un cartellino da 90 × 90,7 mm e, sotto, uno spazio
// per il nome della macchinetta (6 pt, fuori dal cartellino). Tra le colonne ci sono 4 mm; tra le righe lo spazio dell'etichetta.
export const SHEET = { page: [210, 297], margin: 8, cols: 2, rows: 3, card: [90, 90.7], gapX: 4, qr: 52.2, header: 17.8 };
export const PER_PAGE = SHEET.cols * SHEET.rows;
export const MIN_QR_MM = 52;

// Cinque stelle con la stessa forma e lo stesso colore di quelle del sito (style.css, --star-on): punte arrotondate,
// sfumatura ambra dall'alto in basso. Ogni stella ha la sua sfumatura (id diversi).
const STAR = "M12.00 3.80 L14.35 9.46 L20.46 9.95 L15.80 13.94 L17.23 19.90 L12.00 16.70 L6.77 19.90 L8.20 13.94 L3.54 9.95 L9.65 9.46Z";
const starsHtml = (card) => Array.from({ length: 5 }, (_, i) => {
  const id = `sg${card}-${i}`;
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#FFCE5C"/><stop offset="1" stop-color="#F59E0B"/></linearGradient></defs>` +
    `<path d="${STAR}" fill="url(#${id})" stroke="url(#${id})" stroke-width="1.7" stroke-linejoin="round"/></svg>`;
}).join("");

// Uno slot: cartellino (fascia scura con «Mokatvisor» e stelle, QR, frase, nota) + nome della macchinetta fuori dal cartellino
function ticketHtml({ item, svg }, index) {
  const where = [item.small, item.title].filter(Boolean).join(" · ");
  return `
    <div class="slot">
      <article class="ticket">
        <header class="band"><b>Mokatvisor</b><span class="stars" aria-hidden="true">${starsHtml(index)}</span></header>
        <div class="body">
          <div class="qr" role="img" aria-label="QR code: ${esc(where)}">${svg}</div>
          <p class="cta">${esc(item.text)}</p>
          <p class="note">Un gioco fatto da studenti, per studenti: solo per divertirsi.</p>
        </div>
      </article>
      <p class="where">${esc(where)}</p>
    </div>`;
}

// Pagine A4 da 6 cartellini (2 × 3). Il bordo arrotondato è la guida di taglio. Gli slot senza cartellino restano vuoti.
function cartelliniHtml(cards) {
  const { margin, cols, rows, card, gapX, qr, header } = SHEET;
  const slotH = (297 - 2 * margin) / rows; // altezza di uno slot: cartellino + etichetta
  const pages = [];
  for (let i = 0; i < cards.length; i += PER_PAGE) {
    const slots = Array.from({ length: PER_PAGE }, (_, k) => (cards[i + k] ? ticketHtml(cards[i + k], i + k) : '<div class="slot"></div>'));
    pages.push(`  <main class="sheet">${slots.join("\n")}
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
    .sheet { position: relative; width: 194mm; height: 281mm; background: #fff; display: grid; justify-content: center;
             grid-template-columns: repeat(${cols}, ${card[0]}mm); column-gap: ${gapX}mm; grid-template-rows: repeat(${rows}, ${slotH.toFixed(3)}mm); overflow: hidden; }
    .slot { display: flex; flex-direction: column; break-inside: avoid; page-break-inside: avoid; }
    .ticket { height: ${card[1]}mm; border: .25mm solid #d2d2d2; border-radius: 4mm; overflow: hidden; display: flex; flex-direction: column; flex: none; }
    .ticket p { margin: 0; }
    /* Fascia scura in alto */
    .band { height: ${header}mm; flex: none; background: #141414; color: #fff; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2mm; padding-bottom: .4mm; }
    .band b { font-size: 17pt; font-weight: 700; letter-spacing: -.02em; line-height: 1; }
    /* Stelle del sito (la forma ha già il suo margine dentro il riquadro, quindi quasi nessuno spazio fra una e l'altra) */
    .stars { display: flex; gap: .1mm; }
    .stars svg { width: 5.6mm; height: 5.6mm; display: block; }
    /* QR → frase → nota. Il QR ha già ~5 mm di margine bianco (zona di quiete): tra i puntini neri e la frase ci sono 5 mm.
       La frase ha sempre l'altezza di due righe e la nota sta su una riga sola, così tutti i cartellini sono identici. */
    .body { flex: 1; background: #fff; display: flex; flex-direction: column; align-items: center; justify-content: space-between; padding: 0 3mm 4mm; text-align: center; }
    .qr { width: ${qr}mm; height: ${qr}mm; flex: none; }
    .qr svg { display: block; width: 100%; height: 100%; }
    .cta { margin-top: -.9mm !important; height: 10.5mm; display: flex; align-items: center; font-size: 14pt; font-weight: 700; line-height: 1.05; text-wrap: balance; }
    .note { margin-top: 2.8mm !important; height: 3.6mm; display: flex; align-items: center; font-size: 7.4pt; line-height: 1.35; color: #555; white-space: nowrap; }
    /* Nome della macchinetta: fuori dal cartellino, per riconoscerlo dopo il taglio */
    .where { flex: 1; margin: 0; display: flex; align-items: center; justify-content: center; font-size: 6pt; color: #777; text-align: center; }
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
    // Ritaglio del riquadro del QR, ristretto di 0,6 mm per lato (il margine bianco del QR è di circa 5 mm): fuori ci sono la fascia
    // scura e il testo, che non vanno misurati
    const cx = Math.round(px(box.x + 0.6)), cy = Math.round(px(box.y + 0.6)), cw = Math.round(px(box.w - 1.2));
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
console.log(`✔ cartellini.html     ${Math.ceil(built.length / PER_PAGE)} pagine A4, ${built.length} cartellini 90×90,7 mm (2×3, margine ${SHEET.margin} mm)`);

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

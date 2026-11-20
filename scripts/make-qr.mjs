#!/usr/bin/env node
// Genera in qr/ i QR code e i cartellini stampabili delle macchinette.
//
// Uso:   node scripts/make-qr.mjs [indirizzo-base] [--style square|rounded]
// Es.:   node scripts/make-qr.mjs https://TUOUTENTE.github.io/mokatvisor/ --style square
//
// L'indirizzo di ogni macchinetta è <indirizzo-base>?m=<id>. Le macchinette (id, nome, piano) vengono da
// machines.js, lo stesso file del sito. Prima di scrivere qualsiasi file ogni QR viene riletto con un decoder
// indipendente (jsQR) a piena risoluzione, a 200 px e a 200 px sfocato: se anche uno solo fallisce, lo script
// si ferma con errore. Lo stile "rounded" (default) è accettato solo se supera la verifica, altrimenti si usa "square".
import { mkdir, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { MACHINES } from "../machines.js";
import { qrSvg, qrPng, verifyQr } from "./qr-lib.mjs";

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
  let base;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--style") style = argv[++i];
    else if (a.startsWith("--style=")) style = a.slice("--style=".length);
    else if (a.startsWith("--")) fail(`opzione sconosciuta: ${a}`);
    else base ??= a;
  }
  if (style !== "square" && style !== "rounded") fail('--style deve essere "square" oppure "rounded"');
  return { style, base: parseBase(base) };
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

// Un cartellino A6 (105 × 148 mm): marchio, piano (se c'è), nome, QR, invito, nota
function ticketHtml({ m, svg }) {
  return `
    <article class="ticket">
      <header class="top">
        <div class="brand"><b>Mokatvisor</b><span>ISILTeP</span></div>
        <div class="stars" aria-hidden="true">★★★★★</div>
      </header>
      <div class="where">
        ${m.floor ? `<p class="floor">${esc(m.floor)}</p>` : ""}
        <h2>${esc(m.name)}</h2>
      </div>
      <div class="qr" role="img" aria-label="QR code di ${esc(m.name)}">${svg}</div>
      <p class="cta">Hai preso una bevanda? Scansiona e dai le stelle!</p>
      <p class="note">Un gioco tra studenti. Non è un'iniziativa della scuola.</p>
    </article>`;
}

// A4 verticale con 4 cartellini A6 (2 × 2) per pagina, senza margini di pagina: i cartellini riempiono il foglio
// e due linee sottili al centro (più piccoli tacche ai bordi) indicano dove tagliare.
function cartelliniHtml(cards) {
  const PER_PAGE = 4;
  const pages = [];
  for (let i = 0; i < cards.length; i += PER_PAGE) {
    pages.push(`  <main class="sheet">${cards.slice(i, i + PER_PAGE).map(ticketHtml).join("\n")}
  </main>`);
  }
  return `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mokatvisor · cartellini</title>
  <style>
    @page { size: A4 portrait; margin: 0; }
    * { box-sizing: border-box; }
    html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { margin: 0; background: #e6e6e6; color: #111; font: 10pt/1.3 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", sans-serif; }
    .sheet { position: relative; width: 210mm; height: 297mm; margin: 0 auto; background: #fff;
             display: grid; grid-template-columns: 105mm 105mm; grid-template-rows: 148.5mm 148.5mm; overflow: hidden; }
    /* Segni di taglio sottili: linee al centro e tacche ai bordi */
    .sheet::before, .sheet::after { content: ""; position: absolute; background: #b5b5b5; z-index: 2; }
    .sheet::before { left: 0; right: 0; top: 148.5mm; height: .2mm; }
    .sheet::after { top: 0; bottom: 0; left: 105mm; width: .2mm; }
    .ticket { display: flex; flex-direction: column; align-items: center; text-align: center; padding: 9mm 9mm 7mm; break-inside: avoid; }
    .ticket p, .ticket h2 { margin: 0; }
    .top { width: 100%; display: flex; align-items: center; justify-content: space-between; text-align: left; }
    .brand { display: flex; flex-direction: column; line-height: 1.1; }
    .brand b { font-size: 15pt; font-weight: 700; letter-spacing: -.03em; }
    .brand span { font-size: 7.5pt; font-weight: 600; letter-spacing: .06em; color: #6b6b76; }
    .stars { color: ${AMBER}; font-size: 12pt; letter-spacing: .08em; white-space: nowrap; }
    .where { margin-top: 7mm; min-height: 25mm; display: flex; flex-direction: column; justify-content: center; }
    .floor { font-size: 8pt; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: #6b6b76; margin-bottom: 1mm !important; }
    h2 { font-size: 19pt; font-weight: 700; line-height: 1.1; letter-spacing: -.02em; }
    .qr { width: 55mm; height: 55mm; margin: 3mm 0 3mm; }
    .qr svg { display: block; width: 100%; height: 100%; }
    .cta { font-size: 11pt; font-weight: 700; line-height: 1.25; max-width: 80mm; }
    .note { margin-top: auto !important; font-size: 7pt; color: #6b6b76; }
    @media screen { .sheet { margin: 8mm auto; box-shadow: 0 2px 10px rgba(0,0,0,.25); } }
    @media print { body { background: #fff; } .sheet { margin: 0; break-after: page; } .sheet:last-child { break-after: auto; } }
  </style>
</head>
<body>
${pages.join("\n")}
</body>
</html>
`;
}

// PDF con un browser headless, se ce n'è uno installato (variabile CHROME_BIN o percorsi comuni)
function findBrowser() {
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

function makePdf(htmlPath, pdfPath) {
  const browser = findBrowser();
  if (!browser) return false;
  const r = spawnSync(browser, [
    "--headless", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${pdfPath}`, pathToFileURL(htmlPath).href,
  ], { stdio: "ignore", timeout: 60_000 });
  return r.status === 0 && existsSync(pdfPath);
}

/* --------------------------------- Main --------------------------------- */

const { style, base } = parseArgs(process.argv.slice(2));

// 1) Genero e verifico TUTTI i QR prima di scrivere qualsiasi file. Lo stile è uno solo per tutti i cartellini:
//    se anche un solo QR arrotondato non supera la verifica, uso quello quadrato per tutti.
const buildAll = (st) => MACHINES.map((m) => {
  const url = machineUrl(base, m.id);
  return { m, url, ...buildQr(url, st) };
});
let built = buildAll(style);
if (style === "rounded" && built.some((b) => b.problems.length)) {
  for (const b of built.filter((x) => x.problems.length)) {
    console.warn(`⚠ ${b.m.id}: lo stile arrotondato non supera la verifica (${b.problems.join("; ")})`);
  }
  console.warn("⚠ uso lo stile quadrato per tutti i QR\n");
  built = buildAll("square");
}
const failed = built.filter((b) => b.problems.length);
if (failed.length) {
  for (const b of failed) console.error(`✘ ${b.m.id}: ${b.problems.join("; ")}`);
  fail(`${failed.length} QR non decodificabili: non ho scritto nessun file`);
}

// 2) File: <id>.svg (solo QR), <id>.png (>= 1200 px), cartellini.html (+ cartellini.pdf se c'è un browser)
await mkdir(OUT_DIR, { recursive: true });
await rm(path.join(OUT_DIR, "stampa.html"), { force: true }); // vecchio foglio, sostituito da cartellini.html
for (const b of built) {
  await writeFile(path.join(OUT_DIR, `${b.m.id}.svg`), b.svg);
  await writeFile(path.join(OUT_DIR, `${b.m.id}.png`), b.png);
  console.log(`✔ ${b.m.id.padEnd(20)} ${b.style.padEnd(7)} ${b.width} px  ${b.url}`);
}
const htmlPath = path.join(OUT_DIR, "cartellini.html");
await writeFile(htmlPath, cartelliniHtml(built));
console.log(`✔ cartellini.html     A4, 4 cartellini A6 per pagina (${Math.ceil(built.length / 4)} pagine)`);

const pdfPath = path.join(OUT_DIR, "cartellini.pdf");
if (makePdf(htmlPath, pdfPath)) {
  console.log("✔ cartellini.pdf");
} else {
  await rm(pdfPath, { force: true });
  console.log("• cartellini.pdf non creato: nessun browser headless trovato (imposta CHROME_BIN o stampa cartellini.html dal browser).");
}

console.log(`\n✔ Verifica: ${built.length} QR su ${built.length} decodificati (piena risoluzione, 200 px, 200 px sfocato).`);
console.log(`File generati in ${path.relative(process.cwd(), OUT_DIR) || "."}/`);

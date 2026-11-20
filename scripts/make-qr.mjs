#!/usr/bin/env node
// Genera in qr/ un QR code (SVG + PNG) per ogni macchinetta.
//
// Uso:   node scripts/make-qr.mjs <indirizzo-base>
// Es.:   node scripts/make-qr.mjs https://TUOUTENTE.github.io/mokatvisor/
//
// Ogni QR punta a <indirizzo-base>?m=<id-macchinetta>. L'elenco delle macchinette
// viene da machines.js (lo stesso file usato dal sito).
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import QRCode from "qrcode";
import { MACHINES } from "../machines.js";

const OUT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "qr");
// Correzione d'errore Q (la richiesta era "M o superiore"): un cartellino attaccato a una
// macchinetta si sporca e si graffia, e l'indirizzo è corto quindi il QR resta leggibile.
const QR_OPTIONS = { errorCorrectionLevel: "Q", margin: 4 };

function fail(msg) {
  console.error(`Errore: ${msg}`);
  process.exit(1);
}

function parseBase(arg) {
  if (!arg) {
    console.error("Uso: node scripts/make-qr.mjs <indirizzo-base>");
    console.error("Es.: node scripts/make-qr.mjs https://TUOUTENTE.github.io/mokatvisor/");
    process.exit(1);
  }
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

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// Foglio A4 con un cartellino per macchinetta (2 colonne x 3 righe, l'ultimo spazio resta vuoto).
// Il QR è l'SVG incorporato, così il file è autonomo e stampa nitido a qualsiasi dimensione.
function sheetHtml(cards) {
  const tickets = cards.map(({ m, url, svg }) => `
    <article class="ticket">
      <p class="floor">${esc(m.floor)}</p>
      <h2>${esc(m.name)}</h2>
      <div class="qr">${svg}</div>
      <p class="cta">Valuta le bevande di questa macchinetta</p>
      <p class="url">${esc(url)}</p>
      <p class="brand">Mokatvisor · ISILTEP</p>
    </article>`).join("\n");

  return `<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Mokatvisor · cartellini QR</title>
  <style>
    @page { size: A4; margin: 0; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #ddd; color: #000; font: 11pt/1.3 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
    .sheet { width: 210mm; height: 297mm; margin: 0 auto; padding: 10mm; background: #fff;
             display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: repeat(3, 1fr); }
    .ticket { border: 0.3mm dashed #888; padding: 5mm 6mm; display: flex; flex-direction: column;
              align-items: center; text-align: center; break-inside: avoid; }
    .ticket p, .ticket h2 { margin: 0; }
    .floor { font-size: 9pt; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    h2 { font-size: 14pt; line-height: 1.15; margin-top: 1mm !important; }
    .qr { width: 54mm; height: 54mm; margin: 3mm 0 2mm; }
    .qr svg { display: block; width: 100%; height: 100%; }
    .cta { font-size: 11pt; font-weight: 700; }
    .url { font-size: 7.5pt; margin-top: 1.5mm !important; word-break: break-all; }
    .brand { font-size: 8pt; margin-top: auto !important; color: #444; }
    @media screen { .sheet { margin: 10mm auto; box-shadow: 0 2px 10px rgba(0,0,0,.25); } }
    @media print { body { background: #fff; } .sheet { margin: 0; } }
  </style>
</head>
<body>
  <main class="sheet">${tickets}
  </main>
</body>
</html>
`;
}

const base = parseBase(process.argv[2]);
await mkdir(OUT_DIR, { recursive: true });

const cards = [];
for (const m of MACHINES) {
  const url = machineUrl(base, m.id);
  const svg = await QRCode.toString(url, { ...QR_OPTIONS, type: "svg" });
  await writeFile(path.join(OUT_DIR, `${m.id}.svg`), svg);
  await QRCode.toFile(path.join(OUT_DIR, `${m.id}.png`), url, { ...QR_OPTIONS, width: 1024 });
  cards.push({ m, url, svg });
  console.log(`✔ ${m.id.padEnd(18)} ${url}`);
}
await writeFile(path.join(OUT_DIR, "stampa.html"), sheetHtml(cards));
console.log("✔ stampa.html        foglio A4 con i cartellini");
console.log(`\nFile generati in ${path.relative(process.cwd(), OUT_DIR) || "."}/`);

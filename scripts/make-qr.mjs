#!/usr/bin/env node
// Genera in qr/ un QR code (SVG + PNG) per ogni macchinetta.
//
// Uso:   node scripts/make-qr.mjs <indirizzo-base>
// Es.:   node scripts/make-qr.mjs https://TUOUTENTE.github.io/kaffa-isiltep/
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
    console.error("Es.: node scripts/make-qr.mjs https://TUOUTENTE.github.io/kaffa-isiltep/");
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

const base = parseBase(process.argv[2]);
await mkdir(OUT_DIR, { recursive: true });

for (const m of MACHINES) {
  const url = machineUrl(base, m.id);
  const svg = await QRCode.toString(url, { ...QR_OPTIONS, type: "svg" });
  await writeFile(path.join(OUT_DIR, `${m.id}.svg`), svg);
  await QRCode.toFile(path.join(OUT_DIR, `${m.id}.png`), url, { ...QR_OPTIONS, width: 1024 });
  console.log(`✔ ${m.id.padEnd(18)} ${url}`);
}
console.log(`\nFile generati in ${path.relative(process.cwd(), OUT_DIR) || "."}/`);

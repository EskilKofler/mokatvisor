// Generazione e verifica dei QR (usata da make-qr.mjs). Nessun logo né disegno sopra il codice.
import QRCode from "qrcode";
import jsQR from "jsqr";
import { Resvg } from "@resvg/resvg-js";

export const INK = "#111111";   // nero (non puro) su bianco
export const QUIET = 4;          // margine bianco in moduli (minimo richiesto dallo standard)

// Correzione d'errore: M per i moduli quadrati, Q per quelli arrotondati (perdono un po' di superficie)
const LEVEL = { square: "M", rounded: "Q" };

// Matrice di moduli del QR per un testo: { size, dark(x, y) }
function modulesOf(text, style) {
  const qr = QRCode.create(text, { errorCorrectionLevel: LEVEL[style] });
  const { size, data } = qr.modules;
  return { size, dark: (x, y) => data[y * size + x] === 1 };
}

// SVG del solo QR, con il margine bianco incluso. Unità = moduli.
export function qrSvg(text, style = "rounded") {
  const { size, dark } = modulesOf(text, style);
  const total = size + QUIET * 2;
  const r = style === "rounded" ? 0.08 : 0; // arrotondamento lieve (oltre ~0,1 i decoder smettono di leggerlo)
  let body = "";
  if (r) {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (dark(x, y)) body += `<rect x="${x + QUIET}" y="${y + QUIET}" width="1" height="1" rx="${r}"/>`;
      }
    }
  } else {
    // Moduli quadrati: UN solo tracciato (righe di moduli vicini unite). Rettangoli separati lasciano sottili
    // righe chiare fra un modulo e l'altro quando il file viene stampato o convertito in PDF.
    let d = "";
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; ) {
        if (!dark(x, y)) { x++; continue; }
        let len = 0;
        while (x + len < size && dark(x + len, y)) len++;
        d += `M${x + QUIET} ${y + QUIET}h${len}v1h-${len}z`;
        x += len;
      }
    }
    body = `<path d="${d}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="${r ? "geometricPrecision" : "crispEdges"}">` +
    `<rect width="${total}" height="${total}" fill="#ffffff"/><g fill="${INK}">${body}</g></svg>`;
}

// Numero di moduli per lato (margine incluso): serve a scegliere una scala intera per il PNG
export const totalModules = (svg) => Number(/viewBox="0 0 (\d+)/.exec(svg)[1]);

// PNG di almeno minPx di lato, con un numero intero di pixel per modulo (bordi netti)
export function qrPng(svg, minPx = 1200) {
  const total = totalModules(svg);
  const width = Math.ceil(minPx / total) * total;
  const img = new Resvg(svg, { fitTo: { mode: "width", value: width } }).render();
  return { png: img.asPng(), width: img.width };
}

/* ------------------------------- Verifica ------------------------------- */

// Immagine RGBA dell'SVG a una data larghezza
function raster(svg, width) {
  const img = new Resvg(svg, { fitTo: { mode: "width", value: width } }).render();
  return { data: new Uint8ClampedArray(img.pixels), width: img.width, height: img.height };
}

// Sfocatura leggera: media 3×3 (un raggio di un pixel)
function blur({ data, width, height }) {
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0, n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
            sum += data[(yy * width + xx) * 4 + c];
            n++;
          }
        }
        out[(y * width + x) * 4 + c] = sum / n;
      }
      out[(y * width + x) * 4 + 3] = 255;
    }
  }
  return { data: out, width, height };
}

const decode = ({ data, width, height }) => jsQR(data, width, height, { inversionAttempts: "dontInvert" })?.data ?? null;

// Decodifica con jsQR (decoder indipendente da "qrcode") a piena risoluzione, a 200 px e a 200 px sfocato.
// Ritorna l'elenco dei problemi (vuoto = tutto bene).
export function verifyQr(svg, expected, fullWidth) {
  const problems = [];
  const tests = [
    [`${fullWidth} px`, raster(svg, fullWidth)],
    ["200 px", raster(svg, 200)],
    ["200 px sfocato", blur(raster(svg, 200))],
  ];
  for (const [label, img] of tests) {
    const got = decode(img);
    if (got !== expected) problems.push(`${label}: letto ${got === null ? "niente" : `"${got}"`}`);
  }
  return problems;
}

// Dati condivisi: li usano sia il sito (app.js) sia lo script dei QR (scripts/make-qr.mjs).
// Niente import qui: deve funzionare sia nel browser sia in Node.

/* ------------------------------------------------------------------ */
/*  DATI: modifica qui macchinette e bevande                           */
/*  (id: solo minuscole, numeri e trattini; non cambiarli dopo che     */
/*  sono stati raccolti voti, altrimenti i voti vecchi si "staccano")  */
/*  Gli stessi id vanno elencati anche in firestore.rules.             */
/* ------------------------------------------------------------------ */

// Ogni macchinetta descrive il suo pannello per RIGHE, dall'alto in basso: rows[i] = [sinistra, destra].
// `null` = posto vuoto (nessun riquadro): serve perché la posizione sul sito sia quella della macchinetta dal vivo.
// Una bevanda è { id, name } (+ premium: true per le varianti "premium": stesso nome, id diverso, tag PREMIUM).
// Zucchero e bicchiere non sono bevande: non vanno inseriti.
const drink = (id, name, extra = {}) => ({ id, name, ...extra });

// Costruisce la macchinetta e ricava `drinks` (voti e medie): prima la colonna sinistra dall'alto in basso, poi la destra.
function machine({ id, floor, name, rows }) {
  const drinks = [...rows.map((r) => r[0]), ...rows.map((r) => r[1])].filter(Boolean);
  return { id, floor, name, rows, drinks };
}

// Nome con il piano tra parentesi, se la macchinetta ne ha uno (es. «Brambillino sotto» non ha un piano)
export const placeOf = (m) => (m.floor ? `${m.name} (${m.floor})` : m.name);

export const MACHINES = [
  // 3° piano: pannello reale, 6 righe senza posti vuoti né premium
  machine({
    id: "terzo", floor: "3° piano", name: "Macchinetta del terzo piano",
    rows: [
      [drink("espresso", "Caffè espresso"), drink("cappuccino", "Cappuccino")],
      [drink("caffe-lungo", "Caffè lungo"), drink("cappuccino-con-cioccolato", "Cappuccino con cioccolato")],
      [drink("caffe-macchiato", "Caffè macchiato"), drink("bevanda-cioccolato", "Bevanda al gusto di cioccolato")],
      [drink("caffe-al-ginseng-dolce", "Caffè al ginseng dolce"), drink("latte", "Latte")],
      [drink("caffe-macchiato-al-ginseng-dolce", "Caffè macchiato al ginseng dolce"), drink("latte-macchiato", "Latte macchiato")],
      [drink("cappuccino-al-ginseng-dolce", "Cappuccino al ginseng dolce"), drink("bevanda-te-al-limone", "Bevanda al gusto di tè al limone")],
    ],
  }),

  // 4° piano principale: pannello reale. In basso a sinistra c'è un posto vuoto.
  machine({
    id: "quarto-principale", floor: "4° piano", name: "Macchinetta Torretta principale",
    rows: [
      [drink("espresso-premium", "Espresso", { premium: true }), drink("caffe-decaffeinato", "Caffè decaffeinato")],
      [drink("caffe-lungo-premium", "Caffè lungo", { premium: true }), drink("caffe-macchiato-decaffeinato", "Caffè macchiato decaffeinato")],
      [drink("caffe-macchiato-premium", "Caffè macchiato", { premium: true }), drink("cappuccino-decaffeinato", "Cappuccino decaffeinato")],
      [drink("cappuccino-premium", "Cappuccino", { premium: true }), drink("caffe-d-orzo", "Caffè d'orzo")],
      [drink("espresso", "Espresso"), drink("cappuccino-d-orzo", "Cappuccino d'orzo")],
      [drink("caffe-lungo", "Caffè lungo"), drink("caffe-al-ginseng", "Caffè al ginseng")],
      [drink("caffe-macchiato", "Caffè macchiato"), drink("caffe-macchiato-al-ginseng", "Caffè macchiato al ginseng")],
      [drink("cappuccino", "Cappuccino"), drink("bevanda-cioccolato", "Bevanda al gusto di cioccolato")],
      [null, drink("bevanda-te-al-limone", "Bevanda al gusto di tè al limone")],
    ],
  }),

  // 4° piano secondaria: pannello reale, 9 righe. Nella riga 5 a sinistra c'è un posto vuoto.
  machine({
    id: "quarto-secondaria", floor: "4° piano", name: "Macchinetta Torretta secondaria",
    rows: [
      [drink("espresso-premium", "Espresso", { premium: true }), drink("caffe-al-ginseng", "Caffè al ginseng")],
      [drink("caffe-lungo-premium", "Caffè lungo", { premium: true }), drink("caffe-macchiato-al-ginseng", "Caffè macchiato al ginseng")],
      [drink("caffe-macchiato-premium", "Caffè macchiato", { premium: true }), drink("cappuccino-al-ginseng", "Cappuccino al ginseng")],
      [drink("cappuccino-premium", "Cappuccino", { premium: true }), drink("caffe-d-orzo", "Caffè d'orzo")],
      [drink("espresso", "Espresso"), drink("caffe-d-orzo-macchiato", "Caffè d'orzo macchiato")],
      [drink("caffe-lungo", "Caffè lungo"), drink("cappuccino-d-orzo", "Cappuccino d'orzo")],
      [drink("caffe-macchiato", "Caffè macchiato"), drink("bevanda-cioccolato", "Bevanda al gusto di cioccolato")],
      [drink("cappuccino", "Cappuccino"), drink("bevanda-latte", "Bevanda al gusto di latte")],
      [null, drink("bevanda-te-al-limone", "Bevanda al gusto di tè al limone")],
    ],
  }),

  // 6° piano principale: pannello reale, 9 righe. Nella riga 5 a sinistra c'è un posto vuoto.
  machine({
    id: "sesto-principale", floor: "6° piano", name: "Macchinetta Torretta principale",
    rows: [
      [drink("espresso-premium", "Espresso", { premium: true }), drink("caffe-al-ginseng", "Caffè al ginseng")],
      [drink("caffe-lungo-premium", "Caffè lungo", { premium: true }), drink("caffe-macchiato-al-ginseng", "Caffè macchiato al ginseng")],
      [drink("caffe-macchiato-premium", "Caffè macchiato", { premium: true }), drink("cappuccino-al-ginseng", "Cappuccino al ginseng")],
      [drink("cappuccino-premium", "Cappuccino", { premium: true }), drink("caffe-d-orzo", "Caffè d'orzo")],
      [null, drink("caffe-d-orzo-macchiato", "Caffè d'orzo macchiato")],
      [drink("espresso", "Espresso"), drink("cappuccino-d-orzo", "Cappuccino d'orzo")],
      [drink("caffe-lungo", "Caffè lungo"), drink("bevanda-cioccolato", "Bevanda al gusto di cioccolato")],
      [drink("caffe-macchiato", "Caffè macchiato"), drink("bevanda-latte", "Bevanda al gusto di latte")],
      [drink("cappuccino", "Cappuccino"), drink("bevanda-te-al-limone", "Bevanda al gusto di tè al limone")],
    ],
  }),

  // 6° piano secondaria: pannello reale, 6 righe senza posti vuoti né premium
  machine({
    id: "sesto-secondaria", floor: "6° piano", name: "Macchinetta Torretta secondaria",
    rows: [
      [drink("espresso", "Caffè espresso"), drink("caffe-al-ginseng", "Caffè al ginseng")],
      [drink("caffe-lungo", "Caffè lungo"), drink("caffe-macchiato-al-ginseng", "Caffè macchiato al ginseng")],
      [drink("caffe-macchiato", "Caffè macchiato"), drink("cappuccino-al-ginseng", "Cappuccino al ginseng")],
      [drink("cappuccino", "Cappuccino"), drink("bevanda-cioccolato", "Bevanda al gusto di cioccolato")],
      [drink("cappuccino-con-cioccolato", "Cappuccino con cioccolato"), drink("bevanda-latte", "Bevanda al gusto di latte")],
      [drink("bevanda-latte-macchiato", "Bevanda al gusto di latte macchiato"), drink("bevanda-te-al-limone", "Bevanda al gusto di tè al limone")],
    ],
  }),

  // Brambillino sotto: nessun piano. Pannello reale: 9 righe, premium nelle prime 4 a sinistra, posto vuoto a sinistra nella riga 9
  // (dove sul pannello c'è «senza bicchiere»).
  machine({
    id: "brambillino-sotto", floor: null, name: "Brambillino sotto",
    rows: [
      [drink("espresso-premium", "Espresso", { premium: true }), drink("caffe-al-ginseng", "Caffè al ginseng")],
      [drink("caffe-lungo-premium", "Caffè lungo", { premium: true }), drink("caffe-macchiato-al-ginseng", "Caffè macchiato al ginseng")],
      [drink("caffe-macchiato-premium", "Caffè macchiato", { premium: true }), drink("cappuccino-al-ginseng", "Cappuccino al ginseng")],
      [drink("cappuccino-premium", "Cappuccino", { premium: true }), drink("caffe-d-orzo", "Caffè d'orzo")],
      [drink("espresso", "Espresso"), drink("caffe-d-orzo-macchiato", "Caffè d'orzo macchiato")],
      [drink("caffe-lungo", "Caffè lungo"), drink("cappuccino-d-orzo", "Cappuccino d'orzo")],
      [drink("caffe-macchiato", "Caffè macchiato"), drink("bevanda-cioccolato", "Bevanda al gusto di cioccolato")],
      [drink("cappuccino", "Cappuccino"), drink("bevanda-cioccolato-forte", "Bevanda al gusto di cioccolato forte")],
      [null, drink("bevanda-te-al-limone", "Bevanda al gusto di tè al limone")],
    ],
  }),

  // Brambillino sopra: nessun piano. Pannello reale: 6 righe, nessun posto vuoto, nessuna bevanda premium.
  machine({
    id: "brambillino-sopra", floor: null, name: "Brambillino sopra",
    rows: [
      [drink("espresso", "Caffè espresso"), drink("cappuccino", "Cappuccino")],
      [drink("caffe-lungo", "Caffè lungo"), drink("cappuccino-con-cioccolato", "Cappuccino con cioccolato")],
      [drink("caffe-macchiato", "Caffè macchiato"), drink("bevanda-cioccolato", "Bevanda al gusto di cioccolato")],
      [drink("caffe-al-ginseng", "Caffè al ginseng"), drink("latte", "Latte")],
      [drink("ginseng-macchiato", "Ginseng macchiato"), drink("latte-macchiato", "Latte macchiato")],
      [drink("cappuccino-al-ginseng", "Cappuccino al ginseng"), drink("bevanda-te-al-limone", "Bevanda al gusto di tè al limone")],
    ],
  }),
];
// Foto: metti il file in img/<id-macchinetta>.jpg (es. img/terzo.jpg, img/brambillino-sopra.jpg).
// Se il file non c'è, la foto semplicemente non appare.

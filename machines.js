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

// Disposizione standard delle macchinette senza pannello dettagliato (2 a sinistra, 1 a destra)
const BASIC_ROWS = () => [
  [drink("lungo", "Caffè lungo"), drink("cappuccino", "Cappuccino")],
  [drink("espresso", "Caffè espresso"), null],
];

export const MACHINES = [
  // 3° piano: pannello reale, 6 righe senza posti vuoti né premium
  machine({
    id: "piano3", floor: "3° piano", name: "Macchinetta del terzo piano",
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
    id: "piano4-principale", floor: "4° piano", name: "Caffè Torretta principale",
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
    id: "piano4-secondaria", floor: "4° piano", name: "Caffè Torretta secondaria",
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

  // 6° piano principale: pannello dalla foto di esempio (16 bevande, 9 righe a sinistra, 7 a destra)
  machine({
    id: "piano6-principale", floor: "6° piano", name: "Caffè Torretta principale",
    rows: [
      [drink("espresso", "Espresso"), drink("cioccolato", "Cioccolato")],
      [drink("lungo", "Caffè lungo"), drink("cioccolato-forte", "Cioccolato forte")],
      [drink("macchiato", "Caffè macchiato"), drink("cioccolato-latte", "Cioccolato con latte")],
      [drink("cappuccino", "Cappuccino"), drink("caffe-cioccolato", "Caffè + cioccolato")],
      [drink("cappuccino-cioccolato", "Cappuccino + cioccolato"), drink("te-limone", "Tè al limone")],
      [drink("caffe-deca", "Caffè decaffeinato"), drink("latte", "Latte")],
      [drink("lungo-deca", "Caffè lungo deca"), drink("latte-macchiato", "Latte macchiato")],
      [drink("cappuccino-deca", "Cappuccino deca"), null],
      [drink("ginseng", "Caffè al ginseng"), null],
    ],
  }),

  machine({ id: "piano6-secondaria", floor: "6° piano", name: "Caffè Torretta secondaria", rows: BASIC_ROWS() }),
];
// Foto: metti il file in img/<id-macchinetta>.jpg (es. img/piano3.jpg).
// Se il file non c'è, la foto semplicemente non appare.

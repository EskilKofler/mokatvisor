// Dati condivisi: li usano sia il sito (app.js) sia lo script dei QR (scripts/make-qr.mjs).
// Niente import qui: deve funzionare sia nel browser sia in Node.

/* ------------------------------------------------------------------ */
/*  DATI: modifica qui macchinette e bevande                           */
/*  (id: solo minuscole, numeri e trattini; non cambiarli dopo che     */
/*  sono stati raccolti voti, altrimenti i voti vecchi si "staccano")  */
/*  Gli stessi id vanno elencati anche in firestore.rules.             */
/* ------------------------------------------------------------------ */
export const DRINKS = [
  { id: "lungo", name: "Caffè lungo" },
  { id: "espresso", name: "Caffè espresso" },
  { id: "cappuccino", name: "Cappuccino" },
];

// Bevande del pannello reale di una macchinetta (esempio dalla foto: 6° piano principale), nello stesso ordine:
// prima la colonna sinistra dall'alto in basso, poi la destra. Zucchero e bicchiere non sono bevande.
// `leftCount` (in MACHINES) dice quante stanno nella colonna sinistra.
export const PANEL_DRINKS = [
  { id: "espresso", name: "Espresso" },
  { id: "lungo", name: "Caffè lungo" },
  { id: "macchiato", name: "Caffè macchiato" },
  { id: "cappuccino", name: "Cappuccino" },
  { id: "cappuccino-cioccolato", name: "Cappuccino + cioccolato" },
  { id: "caffe-deca", name: "Caffè decaffeinato" },
  { id: "lungo-deca", name: "Caffè lungo deca" },
  { id: "cappuccino-deca", name: "Cappuccino deca" },
  { id: "ginseng", name: "Caffè al ginseng" },
  { id: "cioccolato", name: "Cioccolato" },
  { id: "cioccolato-forte", name: "Cioccolato forte" },
  { id: "cioccolato-latte", name: "Cioccolato con latte" },
  { id: "caffe-cioccolato", name: "Caffè + cioccolato" },
  { id: "te-limone", name: "Tè al limone" },
  { id: "latte", name: "Latte" },
  { id: "latte-macchiato", name: "Latte macchiato" },
];

export const MACHINES = [
  { id: "piano3", floor: "3° piano", name: "Macchinetta del terzo piano", drinks: DRINKS },
  { id: "piano4-principale", floor: "4° piano", name: "Caffè Torretta principale", drinks: DRINKS },
  { id: "piano4-secondaria", floor: "4° piano", name: "Caffè Torretta secondaria", drinks: DRINKS },
  { id: "piano6-principale", floor: "6° piano", name: "Caffè Torretta principale", drinks: PANEL_DRINKS, leftCount: 9 },
  { id: "piano6-secondaria", floor: "6° piano", name: "Caffè Torretta secondaria", drinks: DRINKS },
];
// Foto: metti il file in img/<id-macchinetta>.jpg (es. img/piano3.jpg).
// Se il file non c'è, la foto semplicemente non appare.

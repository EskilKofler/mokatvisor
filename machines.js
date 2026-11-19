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

export const MACHINES = [
  { id: "piano3", floor: "3° piano", name: "Macchinetta del terzo piano", drinks: DRINKS },
  { id: "piano4-principale", floor: "4° piano", name: "Caffè Torretta principale", drinks: DRINKS },
  { id: "piano4-secondaria", floor: "4° piano", name: "Caffè Torretta secondaria", drinks: DRINKS },
  { id: "piano6-principale", floor: "6° piano", name: "Caffè Torretta principale", drinks: DRINKS },
  { id: "piano6-secondaria", floor: "6° piano", name: "Caffè Torretta secondaria", drinks: DRINKS },
];
// Foto: metti il file in img/<id-macchinetta>.jpg (es. img/piano3.jpg).
// Se il file non c'è, la foto semplicemente non appare.

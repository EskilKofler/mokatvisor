# kaffa-isiltep

Sito statico per votare le bevande delle 5 macchinette della scuola ISILTEP ("kaffa-isiltep, by ISILTEP").

## Vincoli
- **Costo 0 €**: hosting su GitHub Pages; Firebase piano Spark (Auth anonima + Google opzionale, Firestore). Niente Cloud Functions, niente servizi a pagamento.
- ~1000 utenti. Un voto per utente e bevanda, modificabile; tutti vedono le medie.
- Voti da 0 a 5 a passi di 0.5.
- Interfaccia in italiano, pensata per il telefono (mobile first).
- Quota Spark Firestore: 50k letture/giorno, 20k scritture/giorno: attenzione a ogni lettura aggiunta.

## Struttura
- `index.html`, `style.css`, `app.js` (modulo ES, Firebase JS SDK da gstatic, nessun build step)
- `machines.js`: elenco macchinette e bevande, condiviso da `app.js` e da `scripts/make-qr.mjs` (QR in `qr/`, ignorata da git)
- Home: Top 3 (podio), Classifica, Le macchinette. `?m=<id>`: macchinetta in grande + link "Vedi tutte" + Top 3
  (id non valido → home). Ogni bevanda è un bottone che apre il pannello di voto (`<dialog>`).
- Classifica: `MIN_VOTES` e `PRIOR_VOTES` in cima ad `app.js`; ordinamento con media bayesiana, a schermo la media vera.
- Dati: `sum` + `count` per bevanda con `getAggregateFromServer` (15 letture per caricamento), cache `sessionStorage` 60 s.
  Dopo un voto si rilegge solo quella bevanda. Attenzione alla quota Spark (50k letture/giorno).
- Animazioni sempre dietro `reducedMotion()` / `prefers-reduced-motion`. Niente `innerHTML`: solo `textContent`.
- `firebase-config.js`: chiavi Firebase (pubbliche per natura; i valori `INCOLLA_QUI` li fornisce l'utente: **mai inventarli**)
- `firestore.rules`, `firestore.indexes.json`: regole e indice, incollati a mano nella console Firebase
- Collezione `ratings`, doc id = `<uid>_<machineId>_<drinkId>`

## Come lavorare
- Modifiche mirate e precise, mai riscritture complete dei file.
- Spiegare cosa si cambia prima di cambiarlo.
- Niente `git push` finché l'utente non lo chiede.
- Prova locale: `python3 -m http.server 8000` → http://localhost:8000

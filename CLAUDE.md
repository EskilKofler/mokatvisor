# kaffa-isiltep

Sito statico per votare le bevande delle 5 macchinette della scuola ISILTEP (marchio: "Kaffa ISILTeP, by Eskil Kofler"; repository e indirizzo: kaffa-isiltep).

## Vincoli
- **Privacy (vincolo assoluto)**: il sito è completamente anonimo perché tra gli studenti ci sono anche minori di 14 anni.
  Niente login (Google incluso), account, nickname, commenti, foto, email o altri dati personali, niente testo libero,
  niente analytics o pubblicità. Si salvano solo voto (0-5), data e il codice anonimo di Firebase Auth.
- **Testi pubblici** (interfaccia, informativa, README, commenti nel codice, messaggi d'errore): non descrivere mai come
  si potrebbe votare più volte o aggirare il limite di un voto per bevanda.
- **Costo 0 €**: hosting su GitHub Pages; Firebase piano Spark (solo Auth anonima, Firestore). Niente Cloud Functions, niente servizi a pagamento.
- ~1000 utenti. Un voto per utente e bevanda, modificabile; tutti vedono le medie.
- Voti da 0 a 5 a passi di 0.5.
- Interfaccia in italiano, pensata per il telefono (mobile first).
- Quota Spark Firestore: 50k letture/giorno, 20k scritture/giorno: attenzione a ogni lettura aggiunta.

## Struttura
- Pagine: `index.html` (Macchinette: home e `?m=`, logica in `app.js`) e `classifica.html` (logica in `classifica.js`);
  gusci HTML minimi, stile in `style.css`. Moduli ES, Firebase JS SDK da gstatic, nessun build step.
- `core.js`: codice comune a tutte le pagine (Firebase/App Check, accesso anonimo, cache, pannello di voto, animazioni,
  barra in alto, informativa). Ogni pagina chiama `start({ page, sections, need })`. **Non duplicare** codice tra pagine:
  se serve a entrambe va in `core.js`.
- `machines.js`: elenco macchinette e bevande, condiviso da `app.js`, `core.js` e `scripts/make-qr.mjs` (QR in `qr/`, ignorata da git)
- Home: 5 menù chiusi (uno per macchinetta, ordine `HOME_ORDER`: 6°, 4°, 3° piano); toccandone uno si apre l'interfaccia
  delle bevande con il voto. `?m=<id>`: macchinetta già aperta + link "Vedi tutte le macchinette" e "Vai alla classifica"
  (id non valido → home). Ogni bevanda è un bottone che apre il pannello di voto. Senza voti: "Diventa il primo a
  lasciare una recensione".
- Classifica (`classifica.js`): **sola lettura, niente voto** (`start({ vote: false })`). Podio 2-1-3 ed elenco
  minimale. `MIN_VOTES` (1) e `PRIOR_VOTES` (1) in cima al file; media bayesiana per ordinare, a parità più voti prima;
  a schermo la media vera e il numero di voti. Titolo visibile assente (h1 solo per screen reader).
- Dati: `sum` + `count` per bevanda con `getAggregateFromServer`. Home: solo le medie dei menù aperti (parte da 0
  letture); `?m=` 3; classifica 15. Cache `sessionStorage` 60 s per bevanda. Dopo un voto si rilegge solo quella
  bevanda. Attenzione alla quota Spark (50k letture/giorno).
- In fondo a ogni pagina: tendina piccola e grigia «Informazioni e privacy» (`<footer id="info">`), costruita da
  `core.js` (testo e costante `CONTACT` = email di contatto). La frase su reCAPTCHA appare solo se App Check è attivo.
  Se cambia ciò che il sito raccoglie o usa, aggiornarla.
- Barra in alto: icona ☕ + "Kaffa ISILTeP" + "by Eskil Kofler" (un solo link alla home) e le voci Macchinette / Classifica.
- Animazioni sempre dietro `reducedMotion()` / `prefers-reduced-motion`. Niente `innerHTML`: solo `textContent`.
- `firebase-config.js`: chiavi Firebase (pubbliche per natura; i valori `INCOLLA_QUI` li fornisce l'utente: **mai inventarli**)
- `firestore.rules`, `firestore.indexes.json`: regole e indice, incollati a mano nella console Firebase
- Collezione `ratings`, doc id = `<uid>_<machineId>_<drinkId>`

## Come lavorare
- Modifiche mirate e precise, mai riscritture complete dei file.
- Spiegare cosa si cambia prima di cambiarlo.
- Niente `git push` finché l'utente non lo chiede.
- Prova locale: `python3 -m http.server 8000` → http://localhost:8000

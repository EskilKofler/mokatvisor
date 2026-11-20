# Mokatvisor

Sito statico per votare le bevande delle 5 macchinette della scuola ISILTEP (il sito si chiama "Mokatvisor"; repository e indirizzo: mokatvisor).

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
- `machines.js`: macchinette e bevande, condiviso da `app.js`, `core.js` e `scripts/make-qr.mjs` (QR in `qr/`, ignorata da git).
  Ogni macchinetta descrive il pannello per RIGHE: `rows[i] = [sinistra, destra]`, `null` = posto vuoto (nessun riquadro,
  la posizione resta quella della macchinetta dal vivo); `drinks` (voti e medie) è ricavato dalle righe. Varianti
  `premium: true` = stesso nome, id diverso, tag PREMIUM (in rosso, variabile `--premium`). Gli id usati vanno tutti in `firestore.rules`: dopo ogni
  cambio di id l'utente deve ripubblicare le regole nella console.
- Home: 5 menù chiusi (uno per macchinetta): piani in ordine 6°, 4°, 3°; nello stesso piano più recensioni prima (poi
  `HOME_ORDER`). Menù chiuso: "Top: bevanda ★ media" + totale voti. `?m=<id>`: macchinetta già aperta + link "Vedi tutte
  le macchinette" e "Vai alla classifica" (id mancante → home; id sconosciuto → home con la riga «Macchinetta non trovata: ecco tutte le altre»;
  maiuscole e spazi ignorati). Id delle macchinette: `terzo`, `quarto-principale`, `quarto-secondaria`, `sesto-principale`, `sesto-secondaria`
  (es. `?m=terzo`, `?m=quarto-principale`). Le bevande di una macchinetta sono una griglia a due
  colonne come il pannello reale, con posizione ESPLICITA (grid-row/grid-column dalle `rows`: il posto vuoto non collassa, sempre
  due colonne anche a 320 px); ogni riquadro (≥ 56 px) è un bottone
  che apre il pannello di voto. Stato per riquadro da `state.mine` (nessuna lettura in più):
  votato = bordo verde continuo; da votare = bordo tratteggiato (niente ☆). Niente badge con il voto: il voto si vede aprendo il
  pannello. Senza voti "Nessun voto ancora"; un solo invito in cima se la macchinetta non ha voti. Breve alone
  verde dopo un voto (spento con prefers-reduced-motion). Niente "Hai votato X di N".
- Voto per macchinetta (`app.js`, regola di interfaccia, non di sicurezza): votabili la macchinetta aperta con `?m=` e quelle già
  aperte così su questo dispositivo (elenco in localStorage, `mokatvisor:macchinette`; senza storage vale per la sessione). Le altre
  mostrano media, voti e il mio voto in sola lettura (pannello `ro-*` in `app.js`, con invito a scansionare il QR). Dalla home non c'è nessun link a `?m=`. Non scrivere nei testi pubblici altro su questo meccanismo.
- Classifica (`classifica.js`): **sola lettura, niente voto** (`start({ vote: false })`). Podio 2-1-3 ed elenco
  minimale. `MIN_VOTES` (1) in cima al file, `PRIOR_VOTES` (1) in `core.js`; media bayesiana per ordinare, a parità più voti prima;
  a schermo la media vera e il numero di voti. Titolo visibile assente (h1 solo per screen reader).
- Dati: `sum` + `count` per bevanda con `getAggregateFromServer`: una lettura per ogni bevanda di ogni macchinetta
  (ora 75, quasi il totale definitivo: attenzione alla quota Spark, 50k letture/giorno). Home e
  classifica le leggono tutte, `?m=` solo quelle della macchinetta. Cache `sessionStorage` 60 s per bevanda. Dopo un voto
  si rilegge solo quella bevanda.
- In fondo a ogni pagina: tendina chiusa «Informazioni e privacy» (senza linea sopra; il contenuto si vede solo toccandola) (`<footer id="info">`), costruita da
  `core.js` (testo e costante `CONTACT` = email di contatto). La frase su reCAPTCHA appare solo se App Check è attivo.
  Se cambia ciò che il sito raccoglie o usa, aggiornarla.
- Barra in alto: solo "Mokatvisor" (un unico link alla home), senza altre scritte, e le voci Macchinette / Classifica; titolo della home «Macchinette dell'ISILTeP». Niente emoji nel logo.
- Caratteri: solo i font di sistema (`--font` in `style.css`: system-ui, Segoe UI, Roboto…), niente font web né file di font, quindi nessuna licenza da pagare.
- Stile: neutro e minimale. Tutti i colori sono variabili CSS in cima a `style.css` (tema chiaro e scuro automatico con
  `prefers-color-scheme`); niente marrone né beige. Sfondo grigio chiarissimo, card bianche con bordo 1px, pulsanti primari
  neri, ambra (`--star`) solo per le stelle, verde (`--ok`) solo per "votato". Raggi 10-14 px, titoli peso 600-700. Per
  cambiare un colore si cambia la variabile, non un esadecimale sparso. Contrasto AA e bersagli ≥ 44 px.
- Stelle del pannello di voto: cinque `.vstar` separate (SVG arrotondato con gradiente ambra), riempimento per stella,
  piccolo "pop" e tick con `navigator.vibrate`; mai sotto i 48 px.
- Animazioni sempre dietro `reducedMotion()` / `prefers-reduced-motion`. Niente `innerHTML`: solo `textContent`.
- `firebase-config.js`: chiavi Firebase (pubbliche per natura; i valori `INCOLLA_QUI` li fornisce l'utente: **mai inventarli**)
  L'id del progetto Firebase (`projectId`, `authDomain`, `storageBucket`) resta quello originale anche se il sito cambia nome: **non toccarlo**.
- `firestore.rules`, `firestore.indexes.json`: regole e indice, incollati a mano nella console Firebase
- Collezione `ratings`, doc id = `<uid>_<machineId>_<drinkId>`

## Come lavorare
- Modifiche mirate e precise, mai riscritture complete dei file.
- Spiegare cosa si cambia prima di cambiarlo.
- Niente `git push` finché l'utente non lo chiede.
- Prova locale: `python3 -m http.server 8000` → http://localhost:8000

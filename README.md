# kaffa-isiltep

*by ISILTEP* — voti delle macchinette della scuola.

Sito statico (HTML + JS) che usa Firebase (Auth anonima + Firestore) e si pubblica gratis su GitHub Pages.

## 1. Crea il progetto Firebase (piano Spark, gratis, niente carta)
1. https://console.firebase.google.com → **Aggiungi progetto** (Analytics non serve).
2. **Impostazioni progetto → Le tue app → Web (</>)** → registra l'app → copia l'oggetto `firebaseConfig` dentro `firebase-config.js`.
3. **Authentication → Metodo di accesso**: abilita **Anonimo** e **Google**.
4. **Authentication → Impostazioni → Domini autorizzati**: aggiungi `IL_TUO_UTENTE.github.io`
   (`localhost` c'è già, per le prove).
5. **Firestore Database → Crea database** (modalità produzione, regione `eur3` o `europe-west`).
6. **Firestore → Regole**: incolla il contenuto di `firestore.rules` → Pubblica.
7. **Firestore → Indici → Composti → Aggiungi**: collezione `ratings`, campi `drinkKey` (crescente) e `value` (crescente).
   In alternativa apri il sito: l'errore in console del browser contiene un link che crea l'indice con un clic.

## App Check (consigliato, gratis)
Blocca script e bot che usano la tua config pubblica per esaurire la quota di Firestore.
1. Registra una chiave **reCAPTCHA v3** su https://www.google.com/recaptcha/admin/create
   (tipo *reCAPTCHA v3*, domini: `IL_TUO_UTENTE.github.io` e `localhost`).
2. Firebase → **App Check → App → la tua app web → reCAPTCHA** → incolla la **chiave segreta**.
3. Incolla la **chiave del sito** in `firebase-config.js` (`appCheckSiteKey`).
4. Pubblica il sito e controlla in App Check → **Richieste** che risultino "verificate".
5. Solo dopo, in App Check → **Cloud Firestore** (e Authentication) → **Applica** (enforce).
6. Prove in locale con l'enforcement attivo: apri `localhost`, copia il *debug token* stampato in console
   e registralo in App Check → ⋮ → **Gestisci token di debug**.

## 2. Prova in locale
```bash
python3 -m http.server 8000
# apri http://localhost:8000
```

## 3. Pubblica su GitHub Pages
1. Crea un repository **pubblico** e carica questi file.
2. **Settings → Pages → Branch: main / (root)** → Save.
3. Il sito sarà su `https://IL_TUO_UTENTE.github.io/kaffa-isiltep/`.

## Foto delle macchinette
Metti i file in `img/` con il nome dell'id: `piano3.jpg`, `piano4-principale.jpg`, `piano4-secondaria.jpg`,
`piano6-principale.jpg`, `piano6-secondaria.jpg`. Comprimi le foto (max ~200 KB l'una).

## Modificare macchinette o bevande
In `machines.js` ci sono gli array `DRINKS` e `MACHINES` (li usano sia il sito sia lo script dei QR).
Gli `id` devono usare solo minuscole, numeri e trattini.
Non cambiare gli id dopo aver raccolto voti.
Gli id ammessi sono elencati anche in `firestore.rules` (`machineId in [...]`, `drinkId in [...]`):
se ne aggiungi uno in `machines.js`, aggiungilo anche lì e ripubblica le regole, altrimenti il voto viene rifiutato.
Se aggiungi una macchinetta, rigenera anche i QR (vedi sopra).

## QR code per le macchinette
Ogni macchinetta ha la sua pagina: `https://TUOUTENTE.github.io/kaffa-isiltep/?m=<id>`
(es. `?m=piano3`). Con `?m=` mancante o non valido si vede la lista completa.

Per generare i QR serve [Node.js](https://nodejs.org) (una volta sola: `npm install`), poi:
```bash
node scripts/make-qr.mjs https://TUOUTENTE.github.io/kaffa-isiltep/
# oppure: npm run qr -- https://TUOUTENTE.github.io/kaffa-isiltep/
```
L'indirizzo base è obbligatorio (non è scritto nel codice). Nella cartella `qr/` trovi, per ogni macchinetta,
`<id>.svg` e `<id>.png` (correzione d'errore Q), più **`qr/stampa.html`**: un foglio A4 con 5 cartellini
(piano, nome, QR, scritta e indirizzo in chiaro). Aprilo nel browser e stampa in A4, scala 100%, senza intestazioni.

**Stampa i QR solo con l'indirizzo definitivo.** Il QR contiene l'indirizzo scritto nel momento in cui lo generi:
se poi cambi nome del repository, utente GitHub o dominio, i cartellini già attaccati non funzionano più.
Prima di stampare: pubblica il sito, apri a mano `.../?m=piano3` per controllare, poi genera e stampa.
La cartella `qr/` è in `.gitignore`: i file si rigenerano quando serve.

## Sicurezza (promemoria)
- Le chiavi in `firebase-config.js` sono pubbliche per natura: contano le regole di Firestore.
- Un voto per utente e bevanda è garantito dalle regole (l'id del documento contiene l'uid).
- Facoltativo ma consigliato: **App Check** con reCAPTCHA v3 (gratis) per bloccare bot e script.

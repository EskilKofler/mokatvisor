# Moka

Voti delle macchinette della scuola ISILTEP.

Sito statico (HTML + JS) che usa Firebase (Auth anonima + Firestore) e si pubblica gratis su GitHub Pages.

## Privacy: niente account, commenti o nickname
Il sito è **completamente anonimo** e deve restarlo: tra gli studenti ci sono anche ragazzi con meno di 14 anni,
quindi non ci sono account, login (nemmeno con Google), nickname, commenti, foto, email o altri dati personali.
Si salvano solo il voto (da 0 a 5) per ogni bevanda, la data e un codice casuale anonimo.
Non aggiungere funzioni che raccolgano dati personali o testo libero, né analisi del traffico o pubblicità.

In fondo a ogni pagina c'è la tendina «Informazioni e privacy», chiusa finché non la tocchi (testo e costante `CONTACT`, cioè l'email di contatto,
in `core.js`): tienila allineata a ciò che il sito fa davvero. La frase su reCAPTCHA compare da sola quando App Check
è attivo.

## 1. Crea il progetto Firebase (piano Spark, gratis, niente carta)
1. https://console.firebase.google.com → **Aggiungi progetto** (Analytics non serve).
2. **Impostazioni progetto → Le tue app → Web (</>)** → registra l'app → copia l'oggetto `firebaseConfig` dentro `firebase-config.js`.
3. **Authentication → Metodo di accesso**: abilita **solo Anonimo**. Google e ogni altro provider devono restare disattivati.
   In **Authentication → Utenti** non devono comparire utenti con email o provider Google (eventuali prove: eliminali).
4. **Authentication → Impostazioni → Domini autorizzati**: puoi aggiungere `IL_TUO_UTENTE.github.io`
   (`localhost` c'è già, per le prove); con il solo accesso anonimo di solito non serve, ma non fa danni.
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
3. Il sito sarà su `https://IL_TUO_UTENTE.github.io/moka-isiltep/`.

## Foto delle macchinette
Metti i file in `img/` con il nome dell'id: `piano3.jpg`, `piano4-principale.jpg`, `piano4-secondaria.jpg`,
`piano6-principale.jpg`, `piano6-secondaria.jpg`. Comprimi le foto (max ~200 KB l'una).

## Modificare macchinette o bevande
In `machines.js` ogni macchinetta descrive il suo pannello **per righe, dall'alto in basso**: `rows[i] = [sinistra, destra]`.
Ogni cella è una bevanda `drink("id", "Nome")` oppure `null` per un **posto vuoto** (nessun riquadro: la posizione sul
sito resta quella della macchinetta dal vivo). Le varianti premium hanno `{ premium: true }`: stesso nome della bevanda
normale ma id diverso, e il sito mostra il tag PREMIUM. Zucchero e bicchiere non sono bevande: non vanno inseriti.
Gli `id` devono usare solo minuscole, numeri e trattini. Non cambiarli dopo aver raccolto voti: i voti sono legati
all'id (`<macchinetta>_<bevanda>`). Attenzione: se in una macchinetta riusi un id che c'era già (es. `espresso`,
`cappuccino`) per una bevanda diversa, i vecchi voti restano attaccati a quell'id: cancellali in Firestore
(collezione `ratings`) prima di raccogliere voti veri.
Gli id ammessi sono elencati anche in `firestore.rules` (`machineId in [...]`, `drinkId in [...]`): l'elenco contiene
l'unione degli id usati da tutte le macchinette (oggi 35). Se aggiungi una macchinetta o una bevanda, aggiungi l'id anche
lì e **ripubblica le regole** nella console Firebase, altrimenti il voto viene rifiutato; togli solo gli id che nessuna
macchinetta usa più. Se aggiungi una macchinetta, rigenera anche i QR (vedi sotto).

## QR code per le macchinette
Ogni macchinetta ha la sua pagina: `https://TUOUTENTE.github.io/moka-isiltep/?m=<id>`
(es. `?m=piano3`): mostra quella macchinetta in grande, con le sue bevande e le medie, poi i link
«Vedi tutte le macchinette» e «Vai alla classifica». Senza `?m=` (o con un id non valido) si vede la home.

## Com'è fatto il sito
- **Pagine:** `index.html` (Macchinette: home e `?m=`) e `classifica.html` (Classifica). In alto c'è una barra fissa con
  il nome del sito e le due voci. Il codice comune (Firebase, accesso anonimo, cache, pannello di voto, animazioni,
  barra e informativa) sta in `core.js`; `app.js` e `classifica.js` disegnano ciascuno la propria pagina.
- **Macchinette (home):** 5 menù chiusi, uno per macchinetta: prima i due del 6° piano, poi i due del 4°, poi il 3°.
  Dentro lo stesso piano sta sopra la macchinetta con più recensioni (a parità, la principale). Il menù chiuso mostra
  la bevanda migliore («Top: Cappuccino ★ 4,6») e il totale dei voti. Toccando una macchinetta si apre la griglia delle
  sue bevande.
- **Bevande di una macchinetta:** griglia a due colonne che rispecchia il pannello reale (prima la colonna sinistra
  dall'alto in basso, poi la destra). Ogni riquadro è un pulsante con il nome e «★ media · N voti»; il tocco apre il
  pannello di voto. Quelli che hai già votato hanno il bordo verde; quelli
  da votare il bordo tratteggiato e una ☆. Toccando una bevanda votata il pannello si apre con le tue stelle e «Il tuo
  voto precedente». Senza voti: «Nessun voto ancora»; se nessuna bevanda della macchinetta ha voti compare un solo invito in
  cima.
  Ogni macchinetta ha la sua disposizione, scritta in `machines.js` per **righe** (vedi sotto): oggi hanno il pannello reale il 3° piano (12 bevande) e il 4° piano
  principale (17, con 4 varianti «PREMIUM» in rosso); il 6° piano principale usa le 16 della foto di esempio; il 4° e il 6°
  piano secondario hanno le 3 bevande di prima, finché non ci sono le foto vere.
- **Classifica:** pagina di **sola lettura** (non si vota da qui): podio con le 3 migliori bevande (la prima al centro e
  più alta) ed elenco di tutte le altre con una barra sottile. In cima a `classifica.js` ci sono `MIN_VOTES` (voti
  minimi per entrare in classifica, ora 1) e `PRIOR_VOTES` (voti «virtuali» della media generale nella media corretta, ora 1, in `core.js`). L'ordine usa la media corretta (bayesiana); a parità di punteggio vince chi ha più voti. A schermo si vede
  sempre la media vera e il numero di voti.
- **Votare:** si tocca una bevanda (in qualsiasi pagina) e si apre un pannello con le stelle (metà sinistra = mezzo
  punto; una nuova recensione parte da 0,0 e il pulsante «Lascia recensione» resta spento finché non tocchi le stelle;
  per dare zero si trascina il dito fino al bordo sinistro delle stelle, da tastiera ← o Home).
- **Letture Firestore:** una media costa una lettura (`sum` + `count` per bevanda). La home e la Classifica leggono la
  media di **ogni bevanda di ogni macchinetta** (oggi 51: 12 + 17 + 3 + 16 + 3; con ~16 bevande per macchinetta saranno ~80), la
  vista `?m=` solo quelle di una macchinetta; i tuoi voti (per colorare i riquadri) si leggono una sola volta con `loadMine` nelle pagine dove si vota; la Classifica non li legge. Le medie restano in cache nella
  scheda per 60 secondi, una voce per bevanda e condivisa tra le pagine; dopo un voto si rilegge solo quella bevanda. Il
  piano Spark ha 50.000 letture al giorno: con tante bevande tienine conto.
- **Movimento ridotto:** con `prefers-reduced-motion` non ci sono coriandoli, conteggi o transizioni.
- **Informazioni e privacy:** tendina piccola e grigia in fondo a ogni pagina (vedi sopra), con l'email di contatto.

Per generare i QR serve [Node.js](https://nodejs.org) (una volta sola: `npm install`), poi:
```bash
node scripts/make-qr.mjs https://TUOUTENTE.github.io/moka-isiltep/
# oppure: npm run qr -- https://TUOUTENTE.github.io/moka-isiltep/
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
- Le regole di Firestore accettano solo i campi previsti (voto da 0 a 5 a passi di 0,5, macchinetta e bevanda
  dell'elenco, data e codice anonimo): nessun testo libero e nessun dato personale.
- Facoltativo ma consigliato: **App Check** con reCAPTCHA v3 (gratis) per bloccare bot e script.

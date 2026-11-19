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
In cima a `app.js` ci sono gli array `DRINKS` e `MACHINES`. Gli `id` devono usare solo minuscole, numeri e trattini.
Non cambiare gli id dopo aver raccolto voti.
Gli id ammessi sono elencati anche in `firestore.rules` (`machineId in [...]`, `drinkId in [...]`):
se ne aggiungi uno in `app.js`, aggiungilo anche lì e ripubblica le regole, altrimenti il voto viene rifiutato.

## Sicurezza (promemoria)
- Le chiavi in `firebase-config.js` sono pubbliche per natura: contano le regole di Firestore.
- Un voto per utente e bevanda è garantito dalle regole (l'id del documento contiene l'uid).
- Facoltativo ma consigliato: **App Check** con reCAPTCHA v3 (gratis) per bloccare bot e script.

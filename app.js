import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInAnonymously,
  GoogleAuthProvider, linkWithPopup, signInWithCredential,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  initializeAppCheck, ReCaptchaV3Provider,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app-check.js";
import {
  getFirestore, collection, doc, setDoc, getDocs, query, where,
  serverTimestamp, getAggregateFromServer, sum, count,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { firebaseConfig, appCheckSiteKey } from "./firebase-config.js";
import { MACHINES } from "./machines.js"; // dati di macchinette e bevande: modificali lì

/* ------------------------------------------------------------------ */
/*  IMPOSTAZIONI                                                       */
/* ------------------------------------------------------------------ */
const CACHE_MS = 60_000;          // le medie restano in sessionStorage per 60 s (risparmia letture Firestore)
const REFRESH_FORCED_MS = 10_000; // minimo tra due aggiornamenti col pulsante ↻

/* ------------------------------------------------------------------ */

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, cls = "", text = "") => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const keyOf = (machineId, drinkId) => `${machineId}_${drinkId}`;
const nfAvg = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const nfVote = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 });
const votesLabel = (n) => `${n} ${n === 1 ? "voto" : "voti"}`;

const configured = !String(firebaseConfig.apiKey).startsWith("INCOLLA");
if (!configured) $("#setup-warning").hidden = false;

// ?m=<id>: quella macchinetta in primo piano (id mancante o non valido → home)
const single = MACHINES.find((m) => m.id === new URLSearchParams(location.search).get("m")) ?? null;
if (single) document.title = `${single.name} (${single.floor}) · kaffa-isiltep`;

// Tutte le bevande, una per (macchinetta, bevanda)
const ENTRIES = MACHINES.flatMap((m) => m.drinks.map((d) => ({ key: keyOf(m.id, d.id), m, d })));

const state = {
  user: null,
  mine: new Map(),     // key -> valore dato da me
  stats: new Map(),    // key -> { sum, n }
  settled: !configured, // true quando il primo caricamento delle medie è finito (anche con errori)
  fetching: false,
  fetchedAt: 0,        // quando sono stati letti (o salvati in cache) i dati attuali
};

let auth, db;
if (configured) {
  const app = initializeApp(firebaseConfig);
  // App Check va inizializzato prima di Auth e Firestore. Saltato se la chiave è ancora un segnaposto.
  if (!String(appCheckSiteKey).startsWith("INCOLLA")) {
    // In locale stampa in console un token di debug da registrare in Firebase → App Check → Gestisci token di debug
    if (location.hostname === "localhost" || location.hostname === "127.0.0.1") {
      self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;
    }
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  }
  auth = getAuth(app);
  db = getFirestore(app);
}

/* ------------------------------ UI ------------------------------ */

let toastTimer;
function toast(msg, ms = 1800) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), ms);
}

function showNotice(msg, onRetry) {
  const n = $("#notice");
  n.replaceChildren(el("span", "", msg));
  if (onRetry) {
    const b = el("button", "btn small ghost", "Riprova");
    b.type = "button";
    b.addEventListener("click", onRetry);
    n.append(b);
  }
  n.hidden = false;
}
const hideNotice = () => { $("#notice").hidden = true; };

// Messaggi comprensibili per chi vota; il dettaglio tecnico resta in console.
function friendlyError(e) {
  switch (e?.code) {
    case "permission-denied":
      return "Al momento non riesco a leggere i voti. Riprova tra poco.";
    case "failed-precondition":
      return "Le classifiche sono ancora in preparazione. Riprova tra qualche minuto.";
    case "unavailable":
    case "deadline-exceeded":
      return "Sembra che la connessione non vada. Controlla la rete e riprova.";
    default:
      return "Qualcosa è andato storto nel caricare i voti. Riprova.";
  }
}

/* ---- Stato dei dati di una bevanda ---- */

function statOf(key) {
  const s = state.stats.get(key);
  if (!s) return { pending: !state.settled, known: false, n: 0, avg: null };
  return { pending: false, known: true, n: s.n, avg: s.n ? s.sum / s.n : null };
}

const countText = (st) => (st.known ? (st.n ? votesLabel(st.n) : "Nessun voto") : "Voti non disponibili");

function mineLine(key) {
  const my = state.mine.get(key);
  return my === undefined
    ? el("span", "drink-you cta", "Tocca per votare")
    : el("span", "drink-you", `Il tuo voto: ${nfVote.format(my)} ★`);
}

function ariaFor(e, st) {
  const my = state.mine.get(e.key);
  const media = st.avg == null ? "nessuna media" : `media ${nfAvg.format(st.avg)}`;
  return `${e.d.name}, ${e.m.name} (${e.m.floor}): ${media}, ${countText(st)}. ` +
    (my === undefined ? "Tocca per votare." : `Il tuo voto: ${nfVote.format(my)}. Tocca per modificarlo.`);
}

// Bottone-bevanda: base comune a card, hero (e più avanti podio e classifica)
function drinkButton(e, spot, cls) {
  const b = el("button", cls);
  b.type = "button";
  b.dataset.key = e.key;   // quale bevanda apre
  b.dataset.spot = spot;   // dove si trova (per rimettere il focus dopo il ridisegno)
  b.setAttribute("aria-label", ariaFor(e, statOf(e.key)));
  return b;
}

const skel = (w) => el("span", `skel ${w}`, " ");

function scoreNum(avg) {
  const s = el("span", "score");
  if (avg == null) { s.append(el("span", "avg-num dim", "–")); return s; }
  s.append(el("span", "avg-num", nfAvg.format(avg)), el("span", "avg-star", "★"));
  return s;
}

// Stelle di sola lettura: riempimento proporzionale alla media
function meter(avg) {
  const m = el("span", "meter");
  m.setAttribute("aria-hidden", "true");
  const i = document.createElement("i");
  i.style.width = `${((avg ?? 0) / 5) * 100}%`;
  m.append(i);
  return m;
}

function photo(m, cls) {
  const img = el("img", cls);
  img.src = `img/${m.id}.jpg`;
  img.alt = `Foto: ${m.name}, ${m.floor}`;
  img.loading = "lazy";
  img.onerror = () => img.remove(); // se la foto non c'è, semplicemente non appare
  return img;
}

/* ---- Riga bevanda dentro la card di una macchinetta ---- */
function drinkRow(e, spot) {
  const st = statOf(e.key);
  const b = drinkButton(e, spot, "drink");
  const main = el("span", "drink-main");
  main.append(el("span", "drink-name", e.d.name));
  main.append(st.pending ? skel("w-60") : el("span", "drink-meta", countText(st)));
  main.append(mineLine(e.key));
  b.append(main, st.pending ? skel("w-40 tall") : scoreNum(st.avg));
  return b;
}

/* ---- Bevanda in grande (vista ?m=) ---- */
function bigDrink(e, spot) {
  const st = statOf(e.key);
  const b = drinkButton(e, spot, "big-drink");
  const main = el("span", "big-main");
  main.append(el("span", "drink-name", e.d.name));
  if (st.pending) {
    main.append(skel("w-80"));
  } else {
    const row = el("span", "big-meta");
    row.append(meter(st.avg), el("span", "", countText(st)));
    main.append(row);
  }
  main.append(mineLine(e.key));
  const num = el("span", "big-num");
  if (st.pending) num.append(skel("w-60 tall"));
  else num.append(scoreNum(st.avg));
  b.append(main, num);
  return b;
}

function renderHero(m) {
  const sec = el("section", "hero");
  sec.setAttribute("aria-labelledby", "hero-title");
  sec.append(photo(m, "hero-photo"));
  const head = el("div", "hero-head");
  const h = el("h2", "", m.name);
  h.id = "hero-title";
  head.append(el("p", "eyebrow", m.floor), h);
  const list = el("div", "hero-drinks");
  for (const d of m.drinks) list.append(bigDrink({ key: keyOf(m.id, d.id), m, d }, `hero:${keyOf(m.id, d.id)}`));
  sec.append(head, list);
  return sec;
}

function moreLink() {
  const p = el("p", "more");
  const a = el("a", "more-link", "Vedi tutte le macchinette →");
  a.href = location.pathname; // stessa pagina, senza ?m=
  p.append(a);
  return p;
}

function renderMachines() {
  const sec = el("section", "section");
  sec.setAttribute("aria-labelledby", "machines-title");
  const h = el("h2", "section-title", "Le macchinette");
  h.id = "machines-title";
  sec.append(h, el("p", "section-sub", "Tocca una bevanda per votarla."));
  const grid = el("div", "machines");
  for (const m of MACHINES) {
    const card = el("article", "mcard");
    card.append(photo(m, "mcard-photo"));
    const body = el("div", "mcard-body");
    body.append(el("p", "eyebrow", m.floor), el("h3", "", m.name));
    for (const d of m.drinks) body.append(drinkRow({ key: keyOf(m.id, d.id), m, d }, `card:${keyOf(m.id, d.id)}`));
    card.append(body);
    grid.append(card);
  }
  sec.append(grid);
  return sec;
}

function sections() {
  if (single) return [renderHero(single), moreLink()];
  return [renderMachines()];
}

function renderView() {
  const view = $("#view");
  // Il ridisegno non deve far perdere il focus a chi usa la tastiera
  const had = document.activeElement?.closest?.("#view") ? document.activeElement.dataset.spot : null;
  view.replaceChildren(...sections());
  view.setAttribute("aria-busy", String(!state.settled));
  if (had) view.querySelector(`[data-spot="${had}"]`)?.focus({ preventScroll: true });
}

/* ----------------------------- Dati ----------------------------- */

// Cache per sessione (sessionStorage): evita di rileggere Firestore a ogni apertura/ritorno sulla scheda
function cacheRead(name) {
  try {
    const o = JSON.parse(sessionStorage.getItem(`kaffa:${name}`));
    return o && Date.now() - o.t < CACHE_MS ? o : null;
  } catch { return null; }
}
function cacheWrite(name, data, t = Date.now()) {
  try { sessionStorage.setItem(`kaffa:${name}`, JSON.stringify({ t, data })); } catch { /* niente storage: pazienza */ }
}

async function loadMine() {
  const name = `mine:${state.user.uid}`;
  let data = cacheRead(name)?.data;
  if (!data) {
    const snap = await getDocs(query(collection(db, "ratings"), where("uid", "==", state.user.uid)));
    data = {};
    snap.forEach((d) => { const { drinkKey, value } = d.data(); data[drinkKey] = value; });
    cacheWrite(name, data);
  }
  state.mine = new Map(Object.entries(data));
  renderView();
}

// Somma e numero dei voti di una bevanda (1 aggregazione = 1 lettura)
async function fetchStat(key) {
  const q = query(collection(db, "ratings"), where("drinkKey", "==", key));
  const res = await getAggregateFromServer(q, { total: sum("value"), n: count() });
  const { total, n } = res.data();
  return { sum: total ?? 0, n };
}

// Ritorna il primo errore incontrato (o null)
async function fetchStats(entries) {
  let error = null;
  const results = await Promise.allSettled(entries.map((e) => fetchStat(e.key)));
  results.forEach((r, i) => {
    if (r.status === "fulfilled") state.stats.set(entries[i].key, r.value);
    else {
      if (!error) console.error(entries[i].key, r.reason); // un solo log per tentativo (di solito la causa è la stessa)
      error ??= r.reason;
    }
  });
  return error;
}

// Ritorna true se i dati sono aggiornati senza errori
async function loadStats({ force = false } = {}) {
  if (!configured || !state.user) return false;
  if (!force) {
    const c = cacheRead("stats");
    if (c) {
      for (const [k, v] of Object.entries(c.data)) state.stats.set(k, v);
      state.fetchedAt = c.t;
      state.settled = true;
      hideNotice();
      renderView();
      return true;
    }
  }
  if (state.fetching) return false;
  state.fetching = true;
  try {
    // Con ?m= prima le 3 bevande della macchinetta, così si vedono subito; poi le altre
    const first = single ? ENTRIES.filter((e) => e.m === single) : ENTRIES;
    let error = await fetchStats(first);
    if (single) {
      renderView();
      if (!error) error = await fetchStats(ENTRIES.filter((e) => e.m !== single));
    }
    state.settled = true;
    state.fetchedAt = Date.now();
    if (error) {
      showNotice(friendlyError(error), () => loadStats({ force: true }));
    } else {
      hideNotice();
      cacheWrite("stats", Object.fromEntries(state.stats), state.fetchedAt);
    }
    renderView();
    return !error;
  } finally {
    state.fetching = false;
  }
}

function renderAccount() {
  const box = $("#account");
  box.replaceChildren();
  const u = state.user;
  if (!u) return;

  const google = u.providerData.find((p) => p.providerId === "google.com");
  if (google) {
    box.append(`Accesso effettuato con Google${google.email ? ` (${google.email})` : ""}. I tuoi voti ti seguono su qualsiasi dispositivo.`);
  } else {
    box.append("Stai votando in modo anonimo: i tuoi voti sono salvati su questo telefono. Se cambi telefono o cancelli i dati del browser non li ritroverai. Vuoi tenerli al sicuro?");
    box.append(document.createElement("br"));
    const btn = el("button", "btn", "Accedi con Google");
    btn.type = "button";
    btn.addEventListener("click", linkGoogle);
    box.append(btn);
  }
}

/* ---------------------------- Account --------------------------- */

const OPEN_IN_BROWSER = "Apri il sito nel browser (Chrome o Safari) per accedere con Google";
// Browser integrati di app (Instagram, WhatsApp, ...): Google vi blocca il login.
const inWebview = /Instagram|FBAN|FBAV|FB_IAB|Snapchat|TikTok|Line\/|MicroMessenger|WhatsApp|; wv\)|(iPhone|iPod|iPad).*AppleWebKit(?!.*Safari)/i
  .test(navigator.userAgent);

async function linkGoogle() {
  if (inWebview) { toast(OPEN_IN_BROWSER, 6000); return; }
  const provider = new GoogleAuthProvider();
  try {
    // Collega Google all'utente anonimo: l'uid resta lo stesso e i voti fatti restano validi.
    await linkWithPopup(auth.currentUser, provider);
    state.user = auth.currentUser;
    renderAccount();
    toast("Account collegato");
  } catch (e) {
    if (e.code === "auth/credential-already-in-use") {
      // Questo Google era già stato usato (es. su un altro telefono): entra in quell'account.
      // I voti dati finora da anonimo restano nell'uid anonimo e non vengono spostati.
      const cred = GoogleAuthProvider.credentialFromError(e);
      try {
        if (!cred) throw new Error("credenziale Google mancante");
        await signInWithCredential(auth, cred);
        toast("Bentornato! Ho ricaricato i tuoi voti");
      } catch (e2) {
        console.error(e2);
        toast("Non sono riuscito a entrare nel tuo account Google, riprova");
      }
    } else if (e.code === "auth/popup-blocked") {
      toast(OPEN_IN_BROWSER, 6000);
    } else if (e.code !== "auth/popup-closed-by-user" && e.code !== "auth/cancelled-popup-request") {
      console.error(e);
      toast("Accesso non riuscito");
    }
  }
}


/* ------------------------------ Avvio --------------------------- */

renderView();

if (configured) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      try { await signInAnonymously(auth); } catch (e) { console.error(e); toast("Impossibile collegarsi"); }
      return;
    }
    if (state.user && state.user.uid !== user.uid) state.mine = new Map(); // altro account: i voti vecchi non valgono
    state.user = user;
    renderAccount();
    try {
      await Promise.all([loadMine(), loadStats()]);
    } catch (e) {
      console.error(e);
      toast("Errore nel caricamento dei dati");
    }
  });

  // Pulsante ↻: aggiorna saltando la cache, ma non più di una volta ogni 10 s
  $("#refresh").addEventListener("click", async () => {
    if (!state.user) return;
    const wait = Math.ceil((state.fetchedAt + REFRESH_FORCED_MS - Date.now()) / 1000);
    if (wait > 0) { toast(`Già aggiornato, riprova tra ${wait} s`); return; }
    const ok = await loadStats({ force: true });
    if (ok) toast("Risultati aggiornati");
  });

  // Tornando sulla scheda: aggiorna solo se la cache (60 s) è scaduta
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.user) loadStats().catch(console.error);
  });
}

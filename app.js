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
  serverTimestamp, getAggregateFromServer, average, count,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { firebaseConfig, appCheckSiteKey } from "./firebase-config.js";
import { MACHINES } from "./machines.js"; // dati di macchinette e bevande: modificali lì

const $ = (sel, root = document) => root.querySelector(sel);
const el = (tag, cls = "", text = "") => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const keyOf = (machineId, drinkId) => `${machineId}_${drinkId}`;
const fmt = (n, dec = 0) =>
  n.toLocaleString("it-IT", { minimumFractionDigits: dec, maximumFractionDigits: dec === 0 ? 1 : dec });

// ?m=<id>: quella macchinetta in alto e aperta, le altre sotto chiuse (id mancante o non valido → tutte chiuse)
const single = MACHINES.find((m) => m.id === new URLSearchParams(location.search).get("m")) ?? null;

const configured = !String(firebaseConfig.apiKey).startsWith("INCOLLA");
if (!configured) $("#setup-warning").hidden = false;

const state = {
  user: null,
  mine: new Map(),   // key -> valore dato da me
  stats: new Map(),  // key -> { avg, n }
  rows: new Map(),   // key -> elementi DOM della riga
};

const openMachines = new Set(); // macchinette aperte: solo di queste carichiamo le medie
const statsAt = new Map();      // machineId -> ora dell'ultimo caricamento delle medie

// Salvataggi da tastiera in attesa (key -> timer), annullabili se cambia l'account
const kbTimers = new Map();
function cancelPendingKeyboardSaves() {
  for (const t of kbTimers.values()) clearTimeout(t);
  kbTimers.clear();
}

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

// Vista singola: titolo della pagina e intestazione con il nome della macchinetta
function applySingleHeader(m) {
  document.title = `${m.name} (${m.floor}) · kaffa-isiltep`;
  $(".top h1").textContent = `☕ ${m.name}`;
  $(".top .by").textContent = `${m.floor} · kaffa-isiltep by ISILTEP`;
}

// Macchinetta aperta/chiusa: le medie si leggono solo per quelle aperte (risparmia letture Firestore)
function onMachineToggle(m, isOpen) {
  if (!isOpen) { openMachines.delete(m.id); return; }
  openMachines.add(m.id);
  // Se le ho lette meno di 60 s fa non rileggo
  if (state.user && Date.now() - (statsAt.get(m.id) ?? 0) > REFRESH_GAP_MS) {
    loadMachineStats(m).catch(console.error);
  }
}

function buildDrink(m, d) {
  const key = keyOf(m.id, d.id);
  const row = el("div", "drink");

  // Media e numero di voti di tutti, sempre visibili; "Recensisci" apre le stelle
  const avgEl = el("div", "avg", "…");
  const mine = el("div", "mine");
  const info = el("div", "drink-info");
  info.append(avgEl, mine);
  const btn = el("button", "btn review", "Recensisci");
  btn.type = "button";
  const top = el("div", "drink-top");
  top.append(info, btn);

  const voteRow = el("div", "vote-row");
  voteRow.hidden = true;
  const stars = el("div", "stars");
  stars.tabIndex = 0;
  stars.setAttribute("role", "slider");
  stars.setAttribute("aria-label", `Il tuo voto per ${d.name}`);
  stars.setAttribute("aria-valuemin", "0");
  stars.setAttribute("aria-valuemax", "5");
  stars.setAttribute("aria-valuestep", "0.5");
  const fill = el("div", "fill");
  stars.append(fill);

  const zero = el("button", "zero", "0");
  zero.type = "button";
  zero.title = "Dai 0 stelle";
  voteRow.append(stars, zero);

  row.append(el("div", "drink-name", d.name), top, voteRow);
  state.rows.set(key, { avgEl, fill, mine, stars, btn, voteRow });

  btn.addEventListener("click", () => {
    voteRow.hidden = !voteRow.hidden;
    updateRow(key);
  });

  // Tap: metà sinistra della stella = mezzo punto, metà destra = punto intero
  stars.addEventListener("click", (e) => {
    const r = stars.getBoundingClientRect();
    let v = Math.ceil(((e.clientX - r.left) / r.width) * 10) / 2;
    v = Math.min(5, Math.max(0.5, v));
    saveRating(m, d, v);
  });
  zero.addEventListener("click", () => saveRating(m, d, 0));

  // Tastiera (con piccolo ritardo per non fare una scrittura a ogni pressione)
  stars.addEventListener("keydown", (e) => {
    const step = { ArrowRight: 0.5, ArrowUp: 0.5, ArrowLeft: -0.5, ArrowDown: -0.5 }[e.key];
    if (!step) return;
    e.preventDefault();
    const cur = state.mine.get(key);
    // Senza voto, qualsiasi freccia parte da 0.5 (lo 0 si dà solo col bottone "0")
    const next = cur == null ? 0.5 : Math.min(5, Math.max(0, cur + step));
    state.mine.set(key, next);
    updateRow(key);
    clearTimeout(kbTimers.get(key));
    kbTimers.set(key, setTimeout(() => {
      kbTimers.delete(key);
      saveRating(m, d, next);
    }, 700));
  });

  updateRow(key);
  return row;
}

// La macchinetta di ?m= è una card sempre aperta (piano e nome sono già nell'intestazione);
// le altre sono <details> chiusi: le bevande compaiono solo toccando il nome.
function buildMachine(m, focus) {
  const card = el(focus ? "section" : "details", "card");
  if (!focus) {
    const head = el("summary", "card-head");
    head.append(el("span", "floor", m.floor), el("h2", "", m.name));
    card.append(head);
    card.addEventListener("toggle", () => onMachineToggle(m, card.open));
  }

  const img = el("img", "photo");
  img.src = `img/${m.id}.jpg`;
  img.alt = `Foto: ${m.name}, ${m.floor}`;
  img.loading = "lazy";
  img.onerror = () => img.remove();
  card.append(img);

  for (const d of m.drinks) card.append(buildDrink(m, d));
  return card;
}

function render() {
  const root = $("#machines");
  root.innerHTML = "";
  state.rows.clear();
  openMachines.clear();

  if (single) {
    openMachines.add(single.id);
    root.append(buildMachine(single, true));
    root.append(el("h2", "others-title", "Altre macchinette"));
  }
  for (const m of MACHINES) {
    if (m !== single) root.append(buildMachine(m, false));
  }
}

function updateRow(key) {
  const r = state.rows.get(key);
  if (!r) return;

  const s = state.stats.get(key);
  r.avgEl.replaceChildren();
  if (!s) {
    r.avgEl.textContent = "…";
  } else if (s.n === 0) {
    r.avgEl.textContent = "Nessun voto";
  } else {
    const b = el("b", "", `★ ${fmt(s.avg, 1)}`);
    r.avgEl.append(b, ` · ${s.n} ${s.n === 1 ? "voto" : "voti"}`);
  }

  const my = state.mine.get(key);
  r.fill.style.width = `${((my ?? 0) / 5) * 100}%`;
  r.stars.setAttribute("aria-valuenow", String(my ?? 0));
  r.mine.textContent = my == null ? "Non ancora votato" : `Il tuo voto: ${fmt(my)}`;

  const open = !r.voteRow.hidden;
  r.btn.textContent = open ? "Chiudi" : my == null ? "Recensisci" : "Modifica voto";
  r.btn.classList.toggle("ghost", open);
  r.btn.setAttribute("aria-expanded", String(open));
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

/* ----------------------------- Dati ----------------------------- */

async function loadMine() {
  const snap = await getDocs(query(collection(db, "ratings"), where("uid", "==", state.user.uid)));
  state.mine.clear();
  snap.forEach((d) => {
    const { drinkKey, value } = d.data();
    state.mine.set(drinkKey, value);
  });
  for (const key of state.rows.keys()) updateRow(key);
}

async function loadStat(key) {
  const q = query(collection(db, "ratings"), where("drinkKey", "==", key));
  const res = await getAggregateFromServer(q, { avg: average("value"), n: count() });
  const { avg, n } = res.data();
  state.stats.set(key, { avg: avg ?? 0, n });
  updateRow(key);
}

let lastStatsLoad = 0;
const REFRESH_GAP_MS = 60_000;        // minimo tra due refresh automatici
const REFRESH_GAP_FORCED_MS = 10_000; // minimo col pulsante "Aggiorna"

async function loadMachineStats(m) {
  statsAt.set(m.id, Date.now());
  await Promise.all(m.drinks.map((d) => {
    const k = keyOf(m.id, d.id);
    return loadStat(k).catch((e) => console.error(k, e));
  }));
}

// Carica le medie delle sole macchinette aperte (3 aggregazioni ciascuna)
async function loadAllStats() {
  lastStatsLoad = Date.now();
  await Promise.all(MACHINES.filter((m) => openMachines.has(m.id)).map(loadMachineStats));
}

// Ricarica le medie delle macchinette aperte solo se è passato abbastanza tempo (risparmia letture Firestore).
// Ritorna 0 se ha aggiornato, altrimenti i secondi da aspettare.
async function refreshStats({ force = false } = {}) {
  const gap = force ? REFRESH_GAP_FORCED_MS : REFRESH_GAP_MS;
  const wait = lastStatsLoad + gap - Date.now();
  if (wait > 0) return Math.ceil(wait / 1000);
  await loadAllStats();
  return 0;
}

async function saveRating(machine, drink, value) {
  if (!state.user) return;
  const key = keyOf(machine.id, drink.id);
  const prev = state.mine.get(key);
  state.mine.set(key, value);
  updateRow(key);
  try {
    await setDoc(doc(db, "ratings", `${state.user.uid}_${key}`), {
      uid: state.user.uid,
      machineId: machine.id,
      drinkId: drink.id,
      drinkKey: key,
      value,
      updatedAt: serverTimestamp(),
    });
    toast(`${drink.name}: ${fmt(value)} ★ salvato`);
    loadStat(key).catch(console.error);
  } catch (e) {
    console.error(e);
    if (prev === undefined) state.mine.delete(key); else state.mine.set(key, prev);
    updateRow(key);
    toast("Errore nel salvataggio, riprova");
  }
}

/* ------------------------------ Avvio --------------------------- */

if (single) applySingleHeader(single);
render();

if (configured) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      try { await signInAnonymously(auth); } catch (e) { console.error(e); toast("Impossibile collegarsi"); }
      return;
    }
    if (state.user && state.user.uid !== user.uid) cancelPendingKeyboardSaves();
    state.user = user;
    renderAccount();
    try {
      await Promise.all([loadMine(), loadAllStats()]);
    } catch (e) {
      console.error(e);
      toast("Errore nel caricamento dei dati");
    }
  });

  $("#refresh").addEventListener("click", async () => {
    const wait = await refreshStats({ force: true });
    toast(wait ? `Già aggiornato, riprova tra ${wait} s` : "Risultati aggiornati");
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.user) refreshStats().catch(console.error);
  });
}

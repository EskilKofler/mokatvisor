// Codice condiviso da tutte le pagine (Macchinette e Classifica): Firebase, accesso anonimo, cache,
// barra in alto, informativa, pannello di voto e animazioni. Ogni pagina chiama start().
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInAnonymously,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  initializeAppCheck, ReCaptchaV3Provider,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app-check.js";
import {
  getFirestore, collection, doc, getDoc, writeBatch, getDocs, query, where,
  serverTimestamp, getAggregateFromServer, sum, count,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { firebaseConfig, appCheckSiteKey } from "./firebase-config.js";
import { MACHINES, placeOf } from "./machines.js"; // dati di macchinette e bevande: modificali lì

/* ------------------------------------------------------------------ */
/*  IMPOSTAZIONI                                                       */
/* ------------------------------------------------------------------ */
const PRIOR_VOTES = 1;           // voti "virtuali" della media generale nella media corretta (bayesiana): piccolo = conta poco
const CACHE_MS = 60_000;          // le medie restano in sessionStorage per 60 s (risparmia letture Firestore)
const REFRESH_FORCED_MS = 10_000; // minimo tra due aggiornamenti col pulsante ↻
const VOTE_GAP_MS = 5 * 60_000;   // una NUOVA recensione ogni 5 minuti per utente (stesso intervallo nelle regole Firestore)
const EDIT_GAP_MS = 5_000;        // minimo tra due modifiche della stessa recensione (stesso intervallo nelle regole)
const editedAt = new Map();       // key -> quando ho salvato quella recensione l'ultima volta (in questa sessione)
const CONTACT = "eskilkofler@gmail.com"; // a chi scrivere per informazioni o cancellazione dei dati

/* ------------------------------------------------------------------ */

export const $ = (sel, root = document) => root.querySelector(sel);
export const el = (tag, cls = "", text = "") => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
// Bevande "premium": stesso nome della normale ma id diverso. Il tag PREMIUM le distingue dove compaiono;
// drinkLabel() è il testo semplice ("Espresso premium") per screen reader, conferme e descrizioni.
export const drinkLabel = (d) => (d.premium ? `${d.name} premium` : d.name);
export function withPremiumTag(node, d) {
  if (d.premium) node.append(" ", el("span", "tag-premium", "PREMIUM"));
  return node;
}
export const keyOf = (machineId, drinkId) => `${machineId}_${drinkId}`;
export const nfAvg = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const nfVote = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 });
export const votesLabel = (n) => `${n} ${n === 1 ? "voto" : "voti"}`;

const configured = !String(firebaseConfig.apiKey).startsWith("INCOLLA");
// L'informativa cita reCAPTCHA solo se App Check è davvero attivo (chiave inserita)
const appCheckOn = configured && !String(appCheckSiteKey).startsWith("INCOLLA");

// Tutte le bevande, una per (macchinetta, bevanda)
export const ENTRIES = MACHINES.flatMap((m) => m.drinks.map((d) => ({ key: keyOf(m.id, d.id), m, d })));

// L'orario dell'ultima recensione resta sul dispositivo, così l'attesa di 5 minuti vale anche dopo un ricaricamento
const LAST_KEY = "mokatvisor:ultimo-voto";
function lastVoteStored() {
  try { const t = Number(localStorage.getItem(LAST_KEY)); return t > 0 && t <= Date.now() ? t : 0; } catch { return 0; }
}
function setLastVote(t) {
  state.lastVoteAt = t;
  try { localStorage.setItem(LAST_KEY, String(t)); } catch { /* niente storage: resta in memoria */ }
}

export const state = {
  user: null,
  mine: new Map(),     // key -> valore dato da me
  pop: null,           // { key, at }: bevanda appena votata, per l'animazione del riquadro
  mineLoaded: false,   // true quando so cosa ho già votato (prima i riquadri restano neutri)
  stats: new Map(),    // key -> { sum, n }
  settled: !configured, // true quando il primo caricamento delle medie è finito (anche con errori)
  loading: new Set(),  // chiavi delle medie in arrivo da Firestore (mostrano lo scheletro)
  fetchedAt: 0,        // quando sono stati letti (o salvati in cache) i dati attuali
  lastVoteAt: lastVoteStored(), // quando ho lasciato l'ultima recensione (ms); ricordato su questo dispositivo
};

// Cosa disegna e quali medie serve alla pagina corrente (impostato da start())
const ctx = { sections: () => [], need: () => ENTRIES, vote: true };

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

export function statOf(key) {
  const s = state.stats.get(key);
  if (!s) return { pending: !state.settled || state.loading.has(key), known: false, n: 0, avg: null };
  return { pending: false, known: true, n: s.n, avg: s.n ? s.sum / s.n : null };
}

// Media corretta (bayesiana): chi ha pochi voti viene "tirato" verso la media generale. Serve solo a ordinare
// (classifica, "Top" delle macchinette): a schermo c'è sempre la media vera.
export function globalMean() {
  let total = 0, votes = 0;
  for (const s of state.stats.values()) { total += s.sum; votes += s.n; }
  return votes ? total / votes : 3; // media di tutti i voti di tutte le bevande
}
export const bayesScore = (s, C) => (s && s.n ? (s.sum + PRIOR_VOTES * C) / (s.n + PRIOR_VOTES) : null);

const countText = (st) => (st.known ? (st.n ? votesLabel(st.n) : "Nessun voto") : "Voti non disponibili");

export function ariaFor(e, st) {
  const my = state.mine.get(e.key);
  const media = st.known && st.n === 0
    ? "ancora nessun voto"
    : `${st.avg == null ? "nessuna media" : `media ${nfAvg.format(st.avg)}`}, ${countText(st)}`;
  return `${drinkLabel(e.d)}, ${placeOf(e.m)}: ${media}. ` +
    (my === undefined ? "Non l'hai ancora votata. Tocca per lasciare una recensione." : `Il tuo voto: ${nfVote.format(my)}. Tocca per modificarlo.`);
}

// Bottone-bevanda: base comune a card, hero, podio e classifica
export function drinkButton(e, spot, cls) {
  const b = el("button", cls);
  b.type = "button";
  b.dataset.key = e.key;   // quale bevanda apre
  b.dataset.spot = spot;   // dove si trova (per rimettere il focus dopo il ridisegno)
  b.setAttribute("aria-label", ariaFor(e, statOf(e.key)));
  return b;
}

export const skel = (w) => el("span", `skel ${w}`, " ");

export function scoreNum(avg) {
  const s = el("span", "score");
  if (avg == null) { s.append(el("span", "avg-num dim", "–")); return s; }
  s.append(el("span", "avg-num", nfAvg.format(avg)), el("span", "avg-star", "★"));
  return s;
}

// Media e numero di voti, sempre vicini
export function scoreBlock(st) {
  const box = el("span", "score-box");
  if (st.pending) { box.append(skel("w-40 tall"), skel("w-40")); return box; }
  box.append(scoreNum(st.avg), el("span", "score-n", st.known ? (st.n ? votesLabel(st.n) : "Nessun voto") : "–"));
  return box;
}

export function photo(m, cls) {
  const img = el("img", cls);
  img.src = `img/${m.id}.jpg`;
  img.alt = `Foto: ${m.floor ? `${m.name}, ${m.floor}` : m.name}`;
  img.loading = "lazy";
  img.onerror = () => img.remove(); // se la foto non c'è, semplicemente non appare
  return img;
}


/* ---- Pezzi comuni delle pagine ---- */

export function refreshButton() {
  const b = el("button", "icon-btn", "↻");
  b.type = "button";
  b.dataset.refresh = "";
  b.setAttribute("aria-label", "Aggiorna i risultati");
  b.title = "Aggiorna i risultati";
  return b;
}

// Piccolo link grigio "Aggiorna i risultati" (per le pagine senza titolo con ↻)
export function refreshLink() {
  const b = el("button", "refresh-link", "↻ Aggiorna i risultati");
  b.type = "button";
  b.dataset.refresh = "";
  return b;
}

// Titolo della pagina (h1) con sottotitolo e pulsante di aggiornamento
export function pageHead(id, title, sub) {
  const head = el("div", "page-head");
  const txt = el("div", "page-head-text");
  const h = el("h1", "page-title", title);
  h.id = id;
  txt.append(h, el("p", "section-sub", sub));
  head.append(txt, refreshButton());
  return head;
}

/* ---- Barra in alto (uguale su tutte le pagine) ---- */

const NAV = [
  { id: "home", label: "Macchinette", href: "./" },
  { id: "rank", label: "Classifica", href: "classifica.html" },
];

function renderTopbar(active) {
  const bar = $("#topbar");
  bar.replaceChildren();
  const nav = el("nav", "topbar-in");
  nav.setAttribute("aria-label", "Principale");
  const brand = el("a", "brand");
  brand.href = "./";
  // Solo il nome del sito: un unico link alla home
  brand.append(el("span", "brand-name", "Mokatvisor"));
  const links = el("div", "nav-links");
  for (const n of NAV) {
    const a = el("a", "nav-link", n.label);
    a.href = n.href;
    if (n.id === active) a.setAttribute("aria-current", "page");
    links.append(a);
  }
  nav.append(brand, links);
  bar.append(nav);
}

/* ---- Informazioni e privacy (in fondo a ogni pagina) ---- */

function infoItems() {
  const servizi = appCheckOn
    ? "Google Firebase (database), GitHub Pages (hosting) e reCAPTCHA di Google per bloccare i bot."
    : "Google Firebase (database) e GitHub Pages (hosting).";
  return [
    ["Cos'è.", "Un gioco per scoprire quali bevande delle macchinette di ISILTEP piacciono di più. È fatto per divertimento e non è un sito ufficiale della scuola."],
    ["Cosa raccogliamo.", "Solo il tuo voto (da 0 a 5) per ogni bevanda, con la data, e un codice casuale salvato su questo telefono. Niente nome, email, foto o posizione."],
    ["A cosa serve il codice.", "Collega i tuoi voti a questo browser, così puoi vedere e cambiare quello che hai dato. Non possiamo risalire a chi sei."],
    ["Cosa si vede.", "Tutti vedono le medie e il numero di voti. Il sito non mostra i voti delle singole persone."],
    ["Servizi usati.", `${servizi} Come ogni sito, questi servizi possono registrare tecnicamente l'indirizzo IP. Non usiamo pubblicità né analisi del traffico.`],
    ["Informazioni e cancellazione dei dati.", "Per chiedere informazioni o la cancellazione dei dati:", CONTACT],
  ];
}

// Informativa: tendina piccola e grigia in fondo alla pagina, chiusa finché non la tocchi
// (<details> nativo: tastiera e screen reader funzionano da soli)
function renderInfo() {
  const root = $("#info");
  root.replaceChildren();
  const box = el("details", "info-box");
  box.append(el("summary", "", "Informazioni e privacy"));
  const ul = el("ul");
  for (const [lead, text, contact] of infoItems()) {
    const li = el("li");
    li.append(el("strong", "", lead), ` ${text}`);
    if (contact) {
      const a = el("a", "", contact);
      a.href = `mailto:${contact}`;
      li.append(" ", a);
    }
    ul.append(li);
  }
  box.append(ul);
  root.append(box);
}

export function renderView() {
  const view = $("#view");
  // Il ridisegno non deve far perdere il focus a chi usa la tastiera
  const had = document.activeElement?.closest?.("#view") ? document.activeElement.dataset.spot : null;
  view.replaceChildren(...ctx.sections());
  view.setAttribute("aria-busy", String(!state.settled));
  if (had) view.querySelector(`[data-spot="${had}"]`)?.focus({ preventScroll: true });
}

/* ----------------------------- Dati ----------------------------- */

// Cache per sessione (sessionStorage): evita di rileggere Firestore a ogni apertura/ritorno sulla scheda
function cacheRead(name) {
  try {
    const o = JSON.parse(sessionStorage.getItem(`mokatvisor:${name}`));
    return o && Date.now() - o.t < CACHE_MS ? o : null;
  } catch { return null; }
}
function cacheWrite(name, data, t = Date.now()) {
  try { sessionStorage.setItem(`mokatvisor:${name}`, JSON.stringify({ t, data })); } catch { /* niente storage: pazienza */ }
}

// Cache delle medie: una voce per bevanda con la propria ora di lettura, così una pagina che
// ne usa solo alcune (?m=) e un'altra che le usa tutte condividono ciò che c'è già
const STATS_CACHE = "mokatvisor:stats2";
function statsCacheRead() {
  try { const o = JSON.parse(sessionStorage.getItem(STATS_CACHE)); return o && typeof o === "object" ? o : {}; }
  catch { return {}; }
}
function statsCacheWrite(keys) {
  try {
    const o = statsCacheRead(), t = Date.now();
    for (const k of keys) { const s = state.stats.get(k); if (s) o[k] = { sum: s.sum, n: s.n, t }; }
    sessionStorage.setItem(STATS_CACHE, JSON.stringify(o));
  } catch { /* niente storage: pazienza */ }
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
  state.mineLoaded = true;
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

// Ritorna true se i dati sono aggiornati senza errori. Usa la cache per le medie ancora fresche (< 60 s)
// e legge da Firestore solo le altre (con force: tutte). Le medie già in arrivo non vengono richieste due volte.
export async function loadStats({ force = false } = {}) {
  if (!configured || !state.user) return false;
  const need = ctx.need();
  const c = statsCacheRead(), now = Date.now();
  const fresh = (e) => !force && c[e.key] && typeof c[e.key].n === "number" && now - c[e.key].t < CACHE_MS;
  let oldest = now;
  for (const e of need.filter(fresh)) {
    state.stats.set(e.key, { sum: c[e.key].sum, n: c[e.key].n });
    oldest = Math.min(oldest, c[e.key].t);
  }
  const toFetch = need.filter((e) => !fresh(e) && !state.loading.has(e.key));
  if (!toFetch.length) {
    if (need.some((e) => state.loading.has(e.key))) return false; // già in arrivo: a fine caricamento si ridisegna
    state.fetchedAt = oldest;
    state.settled = true;
    hideNotice();
    renderView();
    return true;
  }
  for (const e of toFetch) state.loading.add(e.key);
  renderView(); // mostra subito gli scheletri
  let error;
  try {
    error = await fetchStats(toFetch);
  } finally {
    for (const e of toFetch) state.loading.delete(e.key);
  }
  state.settled = true;
  state.fetchedAt = oldest;
  if (error) {
    showNotice(friendlyError(error), () => loadStats({ force: true }));
  } else {
    hideNotice();
    statsCacheWrite(toFetch.map((e) => e.key));
  }
  renderView();
  return !error;
}

/* ----------------------------- Voto ----------------------------- */

// Un'etichetta per ogni mezzo punto: indice = voto * 2
const LABELS = ["Meglio l'acqua", "Ahia", "Proprio no", "Deludente", "Mediocre", "Così così", "Va bene", "Niente male", "Buono!", "Ottimo!", "Top!"];
let sheet, starsEl; // creati da buildSheet()
let vote = null; // { e, spot, value, prev, saving } mentre il pannello è aperto
const reducedMotion = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

function paintSheet() {
  const v = vote.value;
  const fresh = vote.prev == null && !vote.touched; // nuova recensione ancora intatta: parte da 0,0
  const label = fresh ? "Quante stelle?" : LABELS[v * 2];
  // Ogni stella si riempie per conto suo (0, metà o piena); quella che si accende fa un piccolo "pop"
  [...starsEl.children].forEach((star, i) => {
    const f = Math.min(1, Math.max(0, v - i));
    const before = Number(star.dataset.f || 0);
    star.firstChild.style.width = `${f * 100}%`;
    star.classList.toggle("lit", f > 0);
    if (f > before) { star.classList.remove("pop"); void star.offsetWidth; star.classList.add("pop"); }
    star.dataset.f = String(f);
  });
  $("#sheet-label").textContent = label;
  $("#sheet-number").textContent = nfAvg.format(v); // il valore scelto, in grande (anche 4,5)
  starsEl.setAttribute("aria-valuenow", String(v));
  starsEl.setAttribute("aria-valuetext", fresh ? "Nessuna stella ancora" : `${nfVote.format(v)} stelle: ${label}`);
  const save = $("#sheet-save");
  // spento finché non tocchi le stelle (così non parte uno zero per sbaglio) o se il voto non è cambiato
  save.disabled = vote.saving || fresh || v === vote.prev;
  save.textContent = vote.saving ? "Invio…" : vote.prev == null ? "Lascia recensione" : "Aggiorna recensione";
}

function setVote(v) {
  if (!vote || vote.saving) return;
  if (v !== vote.value) navigator.vibrate?.(6); // leggero tick a ogni mezzo punto (dove il telefono lo permette)
  vote.value = v;
  vote.touched = true;
  $("#sheet-error").hidden = true;
  paintSheet();
}

function openSheet(e, spot) {
  if (!state.user || !state.mineLoaded) { toast("Un attimo, ti sto collegando…"); return; }
  const prev = state.mine.get(e.key) ?? null;
  vote = { e, spot, value: prev ?? 0, prev, saving: false, touched: false }; // una nuova recensione parte da 0,0
  $("#sheet-eyebrow").textContent = e.m.floor ?? "";
  const title = $("#sheet-title");
  title.textContent = e.d.name; // azzera anche il tag della bevanda precedente
  withPremiumTag(title, e.d); // + tag PREMIUM se serve
  $("#sheet-sub").textContent = e.m.name;
  $("#sheet-prev").textContent = prev == null
    ? "Sarà la tua prima recensione."
    : `La tua recensione di ora: ${nfVote.format(prev)} ★`;
  $("#sheet-error").hidden = true;
  paintSheet();
  if (typeof sheet.showModal === "function") sheet.showModal(); else sheet.setAttribute("open", "");
  sheet.focus({ preventScroll: true }); // il focus resta sul pannello: sulle stelle comparirebbe un bordo (su iPhone anche al tocco)
}

function afterClose() {
  const spot = vote?.spot;
  vote = null;
  // Il ridisegno può aver sostituito il bottone: rimetto il focus dove era
  if (spot) $("#view").querySelector(`[data-spot="${spot}"]`)?.focus({ preventScroll: true });
}

function finishClose() {
  sheet.classList.remove("closing");
  if (typeof sheet.close === "function") sheet.close(); else sheet.removeAttribute("open");
  afterClose();
}

function closeSheet(now = false) {
  if (!sheet?.open || vote?.saving) return; // sheet non esiste nelle pagine senza voto
  if (now || reducedMotion()) { finishClose(); return; }
  sheet.classList.add("closing");
  setTimeout(finishClose, 200); // = durata dell'animazione di chiusura
}

// Quanto manca alla prossima recensione, in ms (0 = si può votare)
export const voteWaitMs = () => Math.max(0, state.lastVoteAt + VOTE_GAP_MS - Date.now());

// Messaggio gentile quando l'intervallo tra due recensioni non è ancora passato
export function waitMessage(ms) {
  const n = Math.max(1, Math.ceil(ms / 60_000));
  return `Piano, il caffè va gustato! Riprova tra ${n} ${n === 1 ? "minuto" : "minuti"}.`;
}

// Quanto manca alla prossima recensione, in ms (0 = si può votare)
async function waitLeft(uid) {
  let last = state.lastVoteAt;
  if (!last) {
    try { // una sola lettura, solo quando un salvataggio è stato rifiutato
      const snap = await getDoc(doc(db, "limits", uid));
      last = snap.exists() ? snap.data().last.toMillis() : 0;
    } catch { return 0; }
  }
  return Math.max(0, last + VOTE_GAP_MS - Date.now());
}

// Risultato: { ok: true } oppure { ok: false, message } (message solo se va detto qualcosa di preciso)
async function saveRating(e, value, isNew) {
  if (!state.user) return { ok: false };
  const uid = state.user.uid;
  if (isNew) {
    const early = voteWaitMs();
    if (early > 0) return { ok: false, message: waitMessage(early) };
  } else if (Date.now() - (editedAt.get(e.key) ?? 0) < EDIT_GAP_MS) {
    return { ok: false, message: "Con calma, riprova tra qualche secondo." };
  }
  try {
    // una nuova recensione e l'orario dell'ultima si scrivono insieme; una modifica scrive solo la recensione
    const batch = writeBatch(db);
    batch.set(doc(db, "ratings", `${uid}_${e.key}`), {
      uid,
      machineId: e.m.id,
      drinkId: e.d.id,
      drinkKey: e.key,
      value,
      updatedAt: serverTimestamp(),
    });
    if (isNew) batch.set(doc(db, "limits", uid), { last: serverTimestamp() });
    await batch.commit();
  } catch (err) {
    console.error(err);
    const left = isNew ? await waitLeft(uid) : 0;
    if (left > 0) {
      setLastVote(Date.now() + left - VOTE_GAP_MS);
      return { ok: false, message: waitMessage(left) };
    }
    return { ok: false };
  }
  editedAt.set(e.key, Date.now());
  if (isNew) setLastVote(Date.now());
  if (state.user?.uid === uid) {
    state.mine.set(e.key, value);
    cacheWrite(`mine:${uid}`, Object.fromEntries(state.mine));
  }
  return { ok: true };
}

/* ---- Animazioni (tutte spente con prefers-reduced-motion) ---- */

// Il numero scorre dal valore vecchio a quello nuovo
function countUp(node, from, to, ms = 700) {
  const t0 = performance.now();
  const step = (t) => {
    const p = Math.min(1, (t - t0) / ms);
    node.textContent = nfAvg.format(from + (to - from) * (1 - (1 - p) ** 3)); // ease-out
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// Dopo un voto: media, barre e stelle di quella bevanda passano dal vecchio al nuovo valore
function animateStat(key, old, now) {
  if (reducedMotion() || (old.avg === now.avg && old.n === now.n)) return;
  for (const b of $("#view").querySelectorAll(`[data-key="${key}"]`)) {
    const num = b.querySelector(".avg-num");
    if (num && now.avg != null) countUp(num, old.avg ?? 0, now.avg);
    for (const bar of b.querySelectorAll(".bar i")) {
      const target = bar.style.width;
      bar.style.transition = "none"; // riparto dalla larghezza vecchia, poi lascio fare al CSS
      bar.style.width = `${((old.avg ?? 0) / 5) * 100}%`;
      void bar.offsetWidth;
      bar.style.transition = "";
      bar.style.width = target;
    }
    const score = b.querySelector(".score");
    if (score) {
      score.classList.add("bump");
      setTimeout(() => score.classList.remove("bump"), 700);
    }
  }
}

// Coriandoli leggeri: pezzetti colorati che escono da (x, y), salgono e ricadono
const CONFETTI_COLORS = ["#F5A524", "#1F9D55", "#16161A", "#8A8A94"]; // ambra, verde, nero, grigio
function confetti(x, y, count) {
  if (reducedMotion() || !document.body.animate) return;
  let layer = $("#confetti");
  if (!layer) {
    layer = el("div", "confetti-layer");
    layer.id = "confetti";
    layer.setAttribute("aria-hidden", "true");
    document.body.append(layer);
  }
  for (let i = 0; i < count; i++) {
    const p = el("i", "confetto");
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    p.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    layer.append(p);
    const ang = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9; // ventaglio verso l'alto
    const speed = 90 + Math.random() * 150;
    const dx = Math.cos(ang) * speed, up = Math.sin(ang) * speed;
    const fall = 150 + Math.random() * 170;
    const rot = (Math.random() - 0.5) * 720;
    p.animate([
      { transform: "translate(0, 0) rotate(0deg)", opacity: 1 },
      { transform: `translate(${dx * 0.7}px, ${up}px) rotate(${rot / 2}deg)`, opacity: 1, offset: 0.4 },
      { transform: `translate(${dx}px, ${up + fall}px) rotate(${rot}deg)`, opacity: 0 },
    ], { duration: 1000 + Math.random() * 500, easing: "cubic-bezier(.2, .6, .4, 1)", fill: "forwards" })
      .onfinish = () => p.remove();
  }
}

// Festeggia il voto salvato: coriandoli dalla riga votata (+ vibrazione dove esiste)
function celebrate(spot, value) {
  navigator.vibrate?.([14, 50, 22]);
  const row = spot && $("#view").querySelector(`[data-spot="${spot}"]`);
  const r = row?.getBoundingClientRect();
  confetti(r ? r.left + r.width / 2 : innerWidth / 2, r ? r.top + r.height / 2 : innerHeight * 0.6, Math.round(16 + value * 4));
}

// Dopo un voto rileggo solo la media di quella bevanda (1 aggregazione)
async function refreshOne(key) {
  const old = statOf(key);
  let fresh = false;
  try {
    state.stats.set(key, await fetchStat(key));
    fresh = true;
    statsCacheWrite([key]);
  } catch (err) {
    console.error(err);
  }
  renderView();
  if (fresh) animateStat(key, old, statOf(key));
}

async function submitVote() {
  if (!vote || vote.saving || (vote.prev == null && !vote.touched) || vote.value === vote.prev) return;
  const { e, value, spot, prev } = vote;
  vote.saving = true;
  $("#sheet-error").hidden = true;
  paintSheet();
  const res = await saveRating(e, value, prev == null);
  if (!vote) return; // il pannello è stato chiuso nel frattempo (utente cambiato)
  vote.saving = false;
  if (!res.ok) {
    const err = $("#sheet-error");
    err.textContent = res.message ?? "Ops, non è partita. Controlla la connessione e riprova.";
    err.hidden = false;
    paintSheet();
    return;
  }
  closeSheet();
  state.pop = reducedMotion() ? null : { key: e.key, at: performance.now() }; // il riquadro animerà il suo bordo
  renderView();
  setTimeout(() => celebrate(spot, value), reducedMotion() ? 0 : 180); // a pannello ormai chiuso
  refreshOne(e.key);
}

function valueAt(x) {
  const r = starsEl.getBoundingClientRect();
  if (x - r.left <= 4) return 0; // trascinando fino al bordo sinistro (o oltre) si dà zero
  const v = Math.ceil(((x - r.left) / r.width) * 10) / 2; // metà sinistra di una stella = mezzo punto
  return Math.min(5, Math.max(0.5, v));
}

// Ascoltatori del pannello (tocco, trascinamento, tastiera, pulsanti)
function wireSheet() {
  // Tocco/trascinamento sulle stelle
  let dragging = false;
  starsEl.addEventListener("pointerdown", (ev) => {
    dragging = true;
    starsEl.setPointerCapture?.(ev.pointerId);
    setVote(valueAt(ev.clientX));
  });
  starsEl.addEventListener("pointermove", (ev) => { if (dragging) setVote(valueAt(ev.clientX)); });
  for (const t of ["pointerup", "pointercancel"]) starsEl.addEventListener(t, () => { dragging = false; });

  // Tastiera: frecce ±0.5 (la prima freccia di una nuova recensione parte da 0.5), Home = 0, End = 5, Invio = lascia la recensione
  starsEl.addEventListener("keydown", (ev) => {
    if (!vote) return;
    const step = { ArrowRight: 0.5, ArrowUp: 0.5, ArrowLeft: -0.5, ArrowDown: -0.5 }[ev.key];
    if (step) {
      ev.preventDefault();
      const intact = vote.prev == null && !vote.touched;
      setVote(intact ? 0.5 : Math.min(5, Math.max(0, vote.value + step)));
    } else if (ev.key === "Home") { ev.preventDefault(); setVote(0); }
    else if (ev.key === "End") { ev.preventDefault(); setVote(5); }
    else if (ev.key === "Enter") { ev.preventDefault(); submitVote(); }
  });

  $("#sheet-save").addEventListener("click", submitVote);
  sheet.addEventListener("cancel", (ev) => { ev.preventDefault(); closeSheet(); }); // tasto Esc
  sheet.addEventListener("click", (ev) => { if (ev.target === sheet) closeSheet(); }); // tocco sullo sfondo
}

// Costruisce il pannello di voto (un <dialog>) e lo aggiunge alla pagina
function buildSheet() {
  sheet = el("dialog", "sheet");
  sheet.id = "sheet";
  sheet.tabIndex = -1; // si può mettere a fuoco da codice, ma non con Tab
  sheet.setAttribute("aria-labelledby", "sheet-title");
  const inner = el("div", "sheet-in");

  const grip = el("div", "sheet-grip");
  grip.setAttribute("aria-hidden", "true");
  const eyebrow = el("p", "eyebrow"); eyebrow.id = "sheet-eyebrow";
  const title = el("h2", "sheet-title"); title.id = "sheet-title";
  const sub = el("p", "sheet-sub"); sub.id = "sheet-sub";

  starsEl = el("div", "vstars");
  starsEl.id = "sheet-stars";
  starsEl.tabIndex = 0;
  starsEl.setAttribute("role", "slider");
  starsEl.setAttribute("aria-label", "Il tuo voto, da 0 a 5 stelle");
  starsEl.setAttribute("aria-valuemin", "0");
  starsEl.setAttribute("aria-valuemax", "5");
  starsEl.setAttribute("aria-valuestep", "0.5");
  starsEl.setAttribute("aria-valuenow", "0");
  starsEl.setAttribute("aria-valuetext", "Nessun voto");
  for (let n = 0; n < 5; n++) {
    const star = el("span", "vstar");
    star.append(document.createElement("i"));
    starsEl.append(star);
  }

  const row = el("div", "sheet-row");
  const readout = el("div", "sheet-readout");
  const numLine = el("p", "sheet-numline");
  numLine.setAttribute("aria-hidden", "true"); // il valore è già letto dall'etichetta e dalle stelle
  const num = el("span", "sheet-number", "0,0");
  num.id = "sheet-number";
  numLine.append(num, el("span", "sheet-of", " / 5"));
  const label = el("p", "sheet-label", "Quante stelle?");
  label.id = "sheet-label";
  label.setAttribute("aria-live", "polite");
  readout.append(numLine, label);
  row.append(readout);

  const prev = el("p", "sheet-prev"); prev.id = "sheet-prev";
  const err = el("p", "sheet-error"); err.id = "sheet-error"; err.setAttribute("role", "alert"); err.hidden = true;
  const save = el("button", "btn block", "Lascia recensione");
  save.id = "sheet-save";
  save.type = "button";
  save.disabled = true;

  inner.append(grip, eyebrow, title, sub, starsEl, row, prev, err, save);
  sheet.append(inner);
  document.body.append(sheet);
  wireSheet();
}

/* ------------------------------ Avvio --------------------------- */

// Pulsante ↻: aggiorna saltando la cache, ma non più di una volta ogni 10 s
async function refresh() {
  if (!state.user) return;
  const wait = Math.ceil((state.fetchedAt + REFRESH_FORCED_MS - Date.now()) / 1000);
  if (wait > 0) { toast(`Già aggiornato! Riprova tra ${wait} s`); return; }
  const ok = await loadStats({ force: true });
  if (ok) toast("Aggiornato!");
}

// Ogni pagina chiama start(): page = voce attiva nella barra, sections = cosa disegnare,
// need = quali medie servono (di default tutte)
// vote = false: pagina di sola lettura (niente pannello di voto, bevande non cliccabili, non legge i voti dell'utente)
export function start({ page, sections, need, vote: canVote = true }) {
  ctx.sections = sections;
  ctx.vote = canVote;
  if (need) ctx.need = need;
  if (!configured) $("#setup-warning").hidden = false;
  renderTopbar(page);
  renderInfo();
  if (canVote) {
    buildSheet();
    // Tocco su una bevanda → pannello di voto
    $("#view").addEventListener("click", (ev) => {
      const b = ev.target.closest("[data-key]");
      if (!b) return;
      const e = ENTRIES.find((x) => x.key === b.dataset.key);
      if (e) openSheet(e, b.dataset.spot);
    });
  }
  document.addEventListener("click", (ev) => { if (ev.target.closest("[data-refresh]")) refresh(); });

  // Anello di focus solo per chi usa la tastiera: con tocco o mouse (anche quando il focus torna da solo al riquadro
  // dopo un voto) non deve comparire nessun contorno
  const html = document.documentElement;
  html.dataset.input = "pointer";
  addEventListener("keydown", (ev) => { if (ev.key === "Tab" || ev.key.startsWith("Arrow")) html.dataset.input = "keyboard"; }, true);
  addEventListener("pointerdown", () => { html.dataset.input = "pointer"; }, true);

  renderView();

  if (configured) {
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        try { await signInAnonymously(auth); } catch (e) { console.error(e); toast("Non riesco a collegarmi. Riprova tra poco."); }
        return;
      }
      if (state.user && state.user.uid !== user.uid) { // utente diverso da prima: azzero lo stato personale
        state.mine = new Map();
        state.mineLoaded = false;
        closeSheet(true);
      }
      state.user = user;
      try {
        await Promise.all([ctx.vote ? loadMine() : null, loadStats()]);
      } catch (e) {
        console.error(e);
        toast("Ops, non riesco a caricare i dati.");
      }
    });

    // Tornando sulla scheda: aggiorna solo se la cache (60 s) è scaduta
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && state.user) loadStats().catch(console.error);
    });
  }
}

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
  getFirestore, collection, doc, setDoc, getDocs, query, where,
  serverTimestamp, getAggregateFromServer, sum, count,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { firebaseConfig, appCheckSiteKey } from "./firebase-config.js";
import { MACHINES } from "./machines.js"; // dati di macchinette e bevande: modificali lì

/* ------------------------------------------------------------------ */
/*  IMPOSTAZIONI                                                       */
/* ------------------------------------------------------------------ */
const PRIOR_VOTES = 1;           // voti "virtuali" della media generale nella media corretta (bayesiana): piccolo = conta poco
const CACHE_MS = 60_000;          // le medie restano in sessionStorage per 60 s (risparmia letture Firestore)
const REFRESH_FORCED_MS = 10_000; // minimo tra due aggiornamenti col pulsante ↻
const CONTACT = "eskilkofler@gmail.com"; // a chi scrivere per informazioni o cancellazione dei dati

/* ------------------------------------------------------------------ */

export const $ = (sel, root = document) => root.querySelector(sel);
export const el = (tag, cls = "", text = "") => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};
export const keyOf = (machineId, drinkId) => `${machineId}_${drinkId}`;
export const nfAvg = new Intl.NumberFormat("it-IT", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
export const nfVote = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 1 });
export const votesLabel = (n) => `${n} ${n === 1 ? "voto" : "voti"}`;

const configured = !String(firebaseConfig.apiKey).startsWith("INCOLLA");
// L'informativa cita reCAPTCHA solo se App Check è davvero attivo (chiave inserita)
const appCheckOn = configured && !String(appCheckSiteKey).startsWith("INCOLLA");

// Tutte le bevande, una per (macchinetta, bevanda)
export const ENTRIES = MACHINES.flatMap((m) => m.drinks.map((d) => ({ key: keyOf(m.id, d.id), m, d })));

export const state = {
  user: null,
  mine: new Map(),     // key -> valore dato da me
  pop: null,           // { key, at }: bevanda appena votata, per l'animazione del badge
  mineLoaded: false,   // true quando so cosa ho già votato (prima i riquadri restano neutri)
  stats: new Map(),    // key -> { sum, n }
  settled: !configured, // true quando il primo caricamento delle medie è finito (anche con errori)
  loading: new Set(),  // chiavi delle medie in arrivo da Firestore (mostrano lo scheletro)
  fetchedAt: 0,        // quando sono stati letti (o salvati in cache) i dati attuali
};

// Cosa disegna e quali medie serve alla pagina corrente (impostato da start())
const ctx = { sections: () => [], need: () => ENTRIES, vote: true, mine: true };

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
  return `${e.d.name}, ${e.m.name} (${e.m.floor}): ${media}. ` +
    (my === undefined ? "Non l'hai ancora votata. Tocca per votare." : `Il tuo voto: ${nfVote.format(my)}. Tocca per modificarlo.`);
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
  img.alt = `Foto: ${m.name}, ${m.floor}`;
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

// Quante delle bevande indicate l'utente ha già votato (da state.mine: nessuna lettura in più)
export const votedCount = (entries) => entries.filter((e) => state.mine.has(e.key)).length;

// "Hai votato 3 di 16" con una barretta sottile di avanzamento; segnaposto finché non so cosa ho votato
export function progressLine(entries) {
  const box = el("span", "progress");
  if (!state.mineLoaded) { box.append(skel("w-60")); return box; }
  const done = votedCount(entries), total = entries.length;
  const bar = el("span", "progress-bar");
  bar.setAttribute("aria-hidden", "true"); // il numero è già nel testo
  const fill = document.createElement("i");
  fill.style.width = `${total ? (done / total) * 100 : 0}%`;
  bar.append(fill);
  box.append(el("span", "progress-text", `Hai votato ${done} di ${total}`), bar);
  return box;
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
  const logo = el("span", "brand-logo", "☕");
  logo.setAttribute("aria-hidden", "true");
  const text = el("span", "brand-text");
  text.append(el("span", "brand-name", "Kaffa ISILTeP"), el("span", "brand-by", "by Eskil Kofler"));
  brand.append(logo, text); // icona, nome e "by": un solo link alla home
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

// Menù a tendina piccolo e grigio, chiuso di default (<details> nativo: tastiera e screen reader funzionano da soli)
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
    const o = JSON.parse(sessionStorage.getItem(`kaffa:${name}`));
    return o && Date.now() - o.t < CACHE_MS ? o : null;
  } catch { return null; }
}
function cacheWrite(name, data, t = Date.now()) {
  try { sessionStorage.setItem(`kaffa:${name}`, JSON.stringify({ t, data })); } catch { /* niente storage: pazienza */ }
}

// Cache delle medie: una voce per bevanda con la propria ora di lettura, così una pagina che
// ne usa solo alcune (?m=) e un'altra che le usa tutte condividono ciò che c'è già
const STATS_CACHE = "kaffa:stats2";
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
const LABELS = ["Imbevibile", "Pessimo", "Male", "Mah", "Meh", "Così così", "Ok", "Carino", "Buono", "Ottimo", "Top!"];
let sheet, starsEl; // creati da buildSheet()
let vote = null; // { e, spot, value, prev, saving } mentre il pannello è aperto
const reducedMotion = () => !!window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;

function paintSheet() {
  const v = vote.value;
  const label = v == null ? "Tocca le stelle" : LABELS[v * 2];
  $("#sheet-fill").style.width = `${((v ?? 0) / 5) * 100}%`;
  $("#sheet-label").textContent = label;
  starsEl.setAttribute("aria-valuenow", String(v ?? 0));
  starsEl.setAttribute("aria-valuetext", v == null ? "Nessun voto" : `${nfVote.format(v)} stelle: ${label}`);
  $("#sheet-zero").setAttribute("aria-pressed", String(v === 0));
  const save = $("#sheet-save");
  save.disabled = vote.saving || v == null || v === vote.prev; // niente da salvare se non è cambiato
  save.textContent = vote.saving ? "Salvo…" : vote.prev == null ? "Salva voto" : "Aggiorna voto";
}

function setVote(v) {
  if (!vote || vote.saving) return;
  vote.value = v;
  $("#sheet-error").hidden = true;
  paintSheet();
}

function openSheet(e, spot) {
  if (!state.user) { toast("Un attimo, ti sto collegando…"); return; }
  const prev = state.mine.get(e.key) ?? null;
  vote = { e, spot, value: prev, prev, saving: false };
  $("#sheet-eyebrow").textContent = e.m.floor;
  $("#sheet-title").textContent = e.d.name;
  $("#sheet-sub").textContent = e.m.name;
  $("#sheet-prev").textContent = prev == null
    ? "Non hai ancora votato questa bevanda."
    : `Il tuo voto precedente: ${nfVote.format(prev)} ★`;
  $("#sheet-error").hidden = true;
  paintSheet();
  if (typeof sheet.showModal === "function") sheet.showModal(); else sheet.setAttribute("open", "");
  starsEl.focus({ preventScroll: true });
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

async function saveRating(e, value) {
  if (!state.user) return false;
  const uid = state.user.uid;
  try {
    await setDoc(doc(db, "ratings", `${uid}_${e.key}`), {
      uid,
      machineId: e.m.id,
      drinkId: e.d.id,
      drinkKey: e.key,
      value,
      updatedAt: serverTimestamp(),
    });
  } catch (err) {
    console.error(err);
    return false;
  }
  if (state.user?.uid === uid) {
    state.mine.set(e.key, value);
    cacheWrite(`mine:${uid}`, Object.fromEntries(state.mine));
  }
  return true;
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
const CONFETTI_COLORS = ["#f0a91e", "#c47a2c", "#7a431f", "#e9c58b", "#d9534f", "#4f9d69"];
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
  if (!vote || vote.saving || vote.value == null || vote.value === vote.prev) return;
  const { e, value, spot } = vote;
  vote.saving = true;
  $("#sheet-error").hidden = true;
  paintSheet();
  const ok = await saveRating(e, value);
  if (!vote) return; // il pannello è stato chiuso nel frattempo (utente cambiato)
  vote.saving = false;
  if (!ok) {
    const err = $("#sheet-error");
    err.textContent = "Non sono riuscito a salvare il voto. Controlla la connessione e riprova.";
    err.hidden = false;
    paintSheet();
    return;
  }
  closeSheet();
  toast(`${e.d.name}: ${nfVote.format(value)} ★ salvato`);
  state.pop = reducedMotion() ? null : { key: e.key, at: performance.now() }; // il riquadro animerà il suo badge
  renderView();
  setTimeout(() => celebrate(spot, value), reducedMotion() ? 0 : 180); // a pannello ormai chiuso
  refreshOne(e.key);
}

function valueAt(x) {
  const r = starsEl.getBoundingClientRect();
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

  // Tastiera: frecce ±0.5 (senza voto parte da 0.5), Home = 0, End = 5, Invio = salva
  starsEl.addEventListener("keydown", (ev) => {
    if (!vote) return;
    const step = { ArrowRight: 0.5, ArrowUp: 0.5, ArrowLeft: -0.5, ArrowDown: -0.5 }[ev.key];
    if (step) {
      ev.preventDefault();
      setVote(vote.value == null ? 0.5 : Math.min(5, Math.max(0, vote.value + step)));
    } else if (ev.key === "Home") { ev.preventDefault(); setVote(0); }
    else if (ev.key === "End") { ev.preventDefault(); setVote(5); }
    else if (ev.key === "Enter") { ev.preventDefault(); submitVote(); }
  });

  $("#sheet-zero").addEventListener("click", () => setVote(0));
  $("#sheet-save").addEventListener("click", submitVote);
  $("#sheet-close").addEventListener("click", () => closeSheet());
  sheet.addEventListener("cancel", (ev) => { ev.preventDefault(); closeSheet(); }); // tasto Esc
  sheet.addEventListener("click", (ev) => { if (ev.target === sheet) closeSheet(); }); // tocco sullo sfondo
}

// Costruisce il pannello di voto (un <dialog>) e lo aggiunge alla pagina
function buildSheet() {
  sheet = el("dialog", "sheet");
  sheet.id = "sheet";
  sheet.setAttribute("aria-labelledby", "sheet-title");
  const inner = el("div", "sheet-in");

  const grip = el("div", "sheet-grip");
  grip.setAttribute("aria-hidden", "true");
  const close = el("button", "icon-btn sheet-close", "✕");
  close.id = "sheet-close";
  close.type = "button";
  close.setAttribute("aria-label", "Chiudi");
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
  const fill = document.createElement("i");
  fill.id = "sheet-fill";
  starsEl.append(fill);

  const row = el("div", "sheet-row");
  const label = el("p", "sheet-label", "Tocca le stelle");
  label.id = "sheet-label";
  label.setAttribute("aria-live", "polite");
  const zero = el("button", "chip", "Dai 0");
  zero.id = "sheet-zero";
  zero.type = "button";
  zero.setAttribute("aria-pressed", "false");
  zero.setAttribute("aria-label", "Dai zero stelle");
  row.append(label, zero);

  const prev = el("p", "sheet-prev"); prev.id = "sheet-prev";
  const err = el("p", "sheet-error"); err.id = "sheet-error"; err.setAttribute("role", "alert"); err.hidden = true;
  const save = el("button", "btn block", "Salva voto");
  save.id = "sheet-save";
  save.type = "button";
  save.disabled = true;

  inner.append(grip, close, eyebrow, title, sub, starsEl, row, prev, err, save);
  sheet.append(inner);
  document.body.append(sheet);
  wireSheet();
}

/* ------------------------------ Avvio --------------------------- */

// Pulsante ↻: aggiorna saltando la cache, ma non più di una volta ogni 10 s
async function refresh() {
  if (!state.user) return;
  const wait = Math.ceil((state.fetchedAt + REFRESH_FORCED_MS - Date.now()) / 1000);
  if (wait > 0) { toast(`Già aggiornato, riprova tra ${wait} s`); return; }
  const ok = await loadStats({ force: true });
  if (ok) toast("Risultati aggiornati");
}

// Ogni pagina chiama start(): page = voce attiva nella barra, sections = cosa disegnare,
// need = quali medie servono (di default tutte)
// vote = false: pagina di sola lettura (niente pannello di voto, bevande non cliccabili, non legge i voti dell'utente)
// mine = true: carica anche i voti dell'utente (di default solo nelle pagine dove si vota)
export function start({ page, sections, need, vote: canVote = true, mine: wantMine = canVote }) {
  ctx.sections = sections;
  ctx.vote = canVote;
  ctx.mine = wantMine;
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

  renderView();

  if (configured) {
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        try { await signInAnonymously(auth); } catch (e) { console.error(e); toast("Impossibile collegarsi"); }
        return;
      }
      if (state.user && state.user.uid !== user.uid) { // utente diverso da prima: azzero lo stato personale
        state.mine = new Map();
        state.mineLoaded = false;
        closeSheet(true);
      }
      state.user = user;
      try {
        await Promise.all([ctx.mine ? loadMine() : null, loadStats()]);
      } catch (e) {
        console.error(e);
        toast("Errore nel caricamento dei dati");
      }
    });

    // Tornando sulla scheda: aggiorna solo se la cache (60 s) è scaduta
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && state.user) loadStats().catch(console.error);
    });
  }
}

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
const MIN_VOTES = 3;              // voti minimi perché una bevanda entri nel podio e nella classifica "vera"
const PRIOR_VOTES = 5;            // peso della media generale nella media corretta (bayesiana)
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

function sectionHead(id, title, sub) {
  const h = el("h2", "section-title", title);
  h.id = id;
  return [h, el("p", "section-sub", sub)];
}

/* ---- Podio e classifica ---- */

const MEDALS = ["🥇", "🥈", "🥉"];

// Media corretta (bayesiana): chi ha pochi voti viene "tirato" verso la media generale,
// così 3 voti da 5 non battono 40 voti da 4,8. Serve solo a ordinare: a schermo c'è la media vera.
function rankedList() {
  let total = 0, votes = 0;
  for (const s of state.stats.values()) { total += s.sum; votes += s.n; }
  const C = votes ? total / votes : 3; // media di tutti i voti di tutte le bevande
  return ENTRIES.map((e) => {
    const st = statOf(e.key);
    const s = state.stats.get(e.key);
    return {
      ...e, ...st,
      eligible: st.n >= MIN_VOTES,
      score: s && s.n ? (s.sum + PRIOR_VOTES * C) / (s.n + PRIOR_VOTES) : null,
    };
  });
}

const group = (r) => (r.eligible ? 0 : r.n ? 1 : 2); // classifica vera, pochi voti, nessun voto
const byScore = (a, b) =>
  group(a) - group(b) || (b.score ?? -1) - (a.score ?? -1) || b.n - a.n || a.key.localeCompare(b.key);
const allPending = () => ENTRIES.some((e) => statOf(e.key).pending);

function podItem(r, i) {
  const b = drinkButton(r, `top:${r.key}`, `pod p${i + 1}`);
  b.setAttribute("aria-label", `${["Primo", "Secondo", "Terzo"][i]} posto. ${ariaFor(r, r)}`);
  const medal = el("span", "medal", MEDALS[i]);
  medal.setAttribute("aria-hidden", "true");
  const body = el("span", "pod-body");
  body.append(el("span", "pod-name", r.d.name), el("span", "pod-where", `${r.m.name} · ${r.m.floor}`));
  const sc = el("span", "pod-score");
  sc.append(scoreNum(r.avg), el("span", "pod-n", votesLabel(r.n)));
  b.append(medal, body, sc);
  return b;
}

function podEmpty(i, loading) {
  const d = el("div", `pod p${i + 1} empty`);
  d.setAttribute("aria-hidden", loading ? "true" : "false");
  const medal = el("span", "medal", MEDALS[i]);
  medal.setAttribute("aria-hidden", "true");
  const body = el("span", "pod-body");
  if (loading) body.append(skel("w-80"), skel("w-60"));
  else body.append(el("span", "pod-name", "Posto libero"), el("span", "pod-where", `Servono ${MIN_VOTES} voti`));
  d.append(medal, body);
  return d;
}

function renderTop3() {
  const sec = el("section", "section");
  sec.setAttribute("aria-labelledby", "top3-title");
  sec.append(...sectionHead("top3-title", "🏆 Top 3 di sempre", `Contano le bevande con almeno ${MIN_VOTES} voti.`));
  const pod = el("div", "podium");
  if (allPending()) {
    for (let i = 0; i < 3; i++) pod.append(podEmpty(i, true));
    sec.append(pod);
    return sec;
  }
  const top = rankedList().filter((r) => r.eligible).sort(byScore).slice(0, 3);
  if (!top.length) {
    const inv = el("div", "invite");
    inv.append(
      el("p", "invite-emoji", "🏆"),
      el("p", "invite-title", "Il podio è ancora vuoto"),
      el("p", "invite-text", `Servono almeno ${MIN_VOTES} voti per bevanda. Scegli la tua preferita e dai il primo voto!`),
    );
    sec.append(inv);
    return sec;
  }
  for (let i = 0; i < 3; i++) pod.append(top[i] ? podItem(top[i], i) : podEmpty(i, false));
  sec.append(pod);
  return sec;
}

function rankRow(r, pos) {
  const b = drinkButton(r, `rank:${r.key}`, `rank-row${r.eligible ? "" : " few"}`);
  b.setAttribute("aria-label", `${pos ? `${pos}° posto. ` : ""}${ariaFor(r, r)}`);
  const p = el("span", "rank-pos", pos ? (pos <= 3 ? MEDALS[pos - 1] : String(pos)) : "·");
  p.setAttribute("aria-hidden", "true");
  const main = el("span", "rank-main");
  const top = el("span", "rank-top");
  top.append(el("span", "drink-name", r.d.name), el("span", "rank-where", `${r.m.name} · ${r.m.floor}`));
  const bar = el("span", "bar");
  bar.setAttribute("aria-hidden", "true");
  const fill = document.createElement("i");
  fill.style.width = `${((r.avg ?? 0) / 5) * 100}%`;
  bar.append(fill);
  main.append(top, bar, el("span", "rank-meta", r.n ? votesLabel(r.n) : "Nessun voto"));
  b.append(p, main, scoreNum(r.avg));
  return b;
}

function renderRanking() {
  const sec = el("section", "section");
  sec.setAttribute("aria-labelledby", "ranking-title");
  sec.append(...sectionHead("ranking-title", "Classifica",
    "Dalla più apprezzata. La barra è la media; chi ha pochi voti conta meno."));
  const ol = el("ol", "rank");
  if (allPending()) {
    for (let i = 0; i < 5; i++) {
      const li = el("li", "rank-row ghost");
      li.setAttribute("aria-hidden", "true");
      li.append(skel("w-40 tall"), skel("w-80"));
      ol.append(li);
    }
    sec.append(ol);
    return sec;
  }
  let pos = 0, last = -1;
  for (const r of rankedList().sort(byScore)) {
    const g = group(r);
    if (g !== last) {
      if (g === 1) ol.append(el("li", "rank-sep", `Con pochi voti (meno di ${MIN_VOTES})`));
      if (g === 2) ol.append(el("li", "rank-sep", "Ancora nessun voto"));
      last = g;
    }
    const li = el("li");
    li.append(rankRow(r, g === 0 ? ++pos : null));
    ol.append(li);
  }
  sec.append(ol);
  return sec;
}

function renderMachines() {
  const sec = el("section", "section");
  sec.setAttribute("aria-labelledby", "machines-title");
  sec.append(...sectionHead("machines-title", "Le macchinette", "Tocca una bevanda per votarla."));
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
  if (single) return [renderHero(single), moreLink(), renderTop3()];
  return [renderTop3(), renderRanking(), renderMachines()];
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

/* ----------------------------- Voto ----------------------------- */

// Un'etichetta per ogni mezzo punto: indice = voto * 2
const LABELS = ["Imbevibile", "Pessimo", "Male", "Mah", "Meh", "Così così", "Ok", "Carino", "Buono", "Ottimo", "Top!"];
const sheet = $("#sheet");
const starsEl = $("#sheet-stars");
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
  if (!sheet.open || vote?.saving) return;
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

// Dopo un voto rileggo solo la media di quella bevanda (1 aggregazione)
async function refreshOne(key) {
  try {
    state.stats.set(key, await fetchStat(key));
    if (ENTRIES.every((x) => state.stats.has(x.key))) {
      cacheWrite("stats", Object.fromEntries(state.stats), state.fetchedAt || Date.now());
    }
  } catch (err) {
    console.error(err);
  }
  renderView();
}

async function submitVote() {
  if (!vote || vote.saving || vote.value == null || vote.value === vote.prev) return;
  const { e, value } = vote;
  vote.saving = true;
  $("#sheet-error").hidden = true;
  paintSheet();
  const ok = await saveRating(e, value);
  if (!vote) return; // il pannello è stato chiuso nel frattempo (cambio account)
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
  renderView();
  refreshOne(e.key);
}

function valueAt(x) {
  const r = starsEl.getBoundingClientRect();
  const v = Math.ceil(((x - r.left) / r.width) * 10) / 2; // metà sinistra di una stella = mezzo punto
  return Math.min(5, Math.max(0.5, v));
}

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

// Tocco su una bevanda (card, hero, podio, classifica) → pannello di voto
$("#view").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-key]");
  if (!b) return;
  const e = ENTRIES.find((x) => x.key === b.dataset.key);
  if (e) openSheet(e, b.dataset.spot);
});

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
    if (state.user && state.user.uid !== user.uid) { // altro account: i voti vecchi non valgono
      state.mine = new Map();
      closeSheet(true);
    }
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

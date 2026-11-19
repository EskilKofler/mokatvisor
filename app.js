import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInAnonymously,
  GoogleAuthProvider, linkWithPopup, signInWithCredential,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import {
  getFirestore, collection, doc, setDoc, getDocs, query, where,
  serverTimestamp, getAggregateFromServer, average, count,
} from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

/* ------------------------------------------------------------------ */
/*  DATI: modifica qui macchinette e bevande                           */
/*  (id: solo minuscole, numeri e trattini; non cambiarli dopo che     */
/*  sono stati raccolti voti, altrimenti i voti vecchi si "staccano")  */
/* ------------------------------------------------------------------ */
const DRINKS = [
  { id: "lungo", name: "Caffè lungo" },
  { id: "espresso", name: "Caffè espresso" },
  { id: "cappuccino", name: "Cappuccino" },
];

const MACHINES = [
  { id: "piano3", floor: "3° piano", name: "Macchinetta del terzo piano", drinks: DRINKS },
  { id: "piano4-principale", floor: "4° piano", name: "Caffè Torretta principale", drinks: DRINKS },
  { id: "piano4-secondaria", floor: "4° piano", name: "Caffè Torretta secondaria", drinks: DRINKS },
  { id: "piano6-principale", floor: "6° piano", name: "Caffè Torretta principale", drinks: DRINKS },
  { id: "piano6-secondaria", floor: "6° piano", name: "Caffè Torretta secondaria", drinks: DRINKS },
];
// Foto: metti il file in img/<id-macchinetta>.jpg (es. img/piano3.jpg).
// Se il file non c'è, la foto semplicemente non appare.

/* ------------------------------------------------------------------ */

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

const configured = !String(firebaseConfig.apiKey).startsWith("INCOLLA");
if (!configured) $("#setup-warning").hidden = false;

const state = {
  user: null,
  mine: new Map(),   // key -> valore dato da me
  stats: new Map(),  // key -> { avg, n }
  rows: new Map(),   // key -> elementi DOM della riga
};

let auth, db;
if (configured) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}

/* ------------------------------ UI ------------------------------ */

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
}

function render() {
  const root = $("#machines");
  root.innerHTML = "";
  state.rows.clear();

  for (const m of MACHINES) {
    const card = el("section", "card");
    const head = el("div", "card-head");
    head.append(el("span", "floor", m.floor), el("h2", "", m.name));
    card.append(head);

    const img = el("img", "photo");
    img.src = `img/${m.id}.jpg`;
    img.alt = `Foto: ${m.name}, ${m.floor}`;
    img.loading = "lazy";
    img.onerror = () => img.remove();
    card.append(img);

    for (const d of m.drinks) {
      const key = keyOf(m.id, d.id);
      const row = el("div", "drink");

      const top = el("div", "drink-top");
      const avgEl = el("span", "avg", "…");
      top.append(el("span", "drink-name", d.name), avgEl);

      const voteRow = el("div", "vote-row");
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
      const mine = el("span", "mine");

      voteRow.append(stars, zero, mine);
      row.append(top, voteRow);
      card.append(row);

      state.rows.set(key, { avgEl, fill, mine, stars });

      // Tap: metà sinistra della stella = mezzo punto, metà destra = punto intero
      stars.addEventListener("click", (e) => {
        const r = stars.getBoundingClientRect();
        let v = Math.ceil(((e.clientX - r.left) / r.width) * 10) / 2;
        v = Math.min(5, Math.max(0.5, v));
        saveRating(m, d, v);
      });
      zero.addEventListener("click", () => saveRating(m, d, 0));

      // Tastiera (con piccolo ritardo per non fare una scrittura a ogni pressione)
      let kbTimer;
      stars.addEventListener("keydown", (e) => {
        const step = { ArrowRight: 0.5, ArrowUp: 0.5, ArrowLeft: -0.5, ArrowDown: -0.5 }[e.key];
        if (!step) return;
        e.preventDefault();
        const next = Math.min(5, Math.max(0, (state.mine.get(key) ?? 0) + step));
        state.mine.set(key, next);
        updateRow(key);
        clearTimeout(kbTimer);
        kbTimer = setTimeout(() => saveRating(m, d, next), 700);
      });

      updateRow(key);
    }
    root.append(card);
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

async function linkGoogle() {
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

async function loadAllStats() {
  const keys = [...state.rows.keys()];
  await Promise.all(keys.map((k) => loadStat(k).catch((e) => console.error(k, e))));
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

render();

if (configured) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      try { await signInAnonymously(auth); } catch (e) { console.error(e); toast("Impossibile collegarsi"); }
      return;
    }
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
    await loadAllStats();
    toast("Risultati aggiornati");
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && state.user) loadAllStats();
  });
}

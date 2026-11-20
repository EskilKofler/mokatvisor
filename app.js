import {
  start, $, el, keyOf, ENTRIES, statOf, drinkButton, skel, photo,
  pageHead, refreshButton, renderView, state, nfAvg, nfVote, votesLabel, globalMean, bayesScore, } from "./core.js";
import { MACHINES } from "./machines.js";

// ?m=<id>: quella macchinetta in primo piano (id mancante o non valido → home)
const single = MACHINES.find((m) => m.id === new URLSearchParams(location.search).get("m")) ?? null;
if (single) document.title = `${single.name} (${single.floor}) · Moka`;

// Ordine dei menù nella home (i dati in machines.js non si toccano): 6° piano, 4° piano, 3° piano
const HOME_ORDER = ["piano6-principale", "piano6-secondaria", "piano4-principale", "piano4-secondaria", "piano3"];
const homeRank = (m) => { const i = HOME_ORDER.indexOf(m.id); return i < 0 ? HOME_ORDER.length : i; };
const FALLBACK_ORDER = [...MACHINES].sort((a, b) => homeRank(a) - homeRank(b)); // finché le medie non arrivano

// Voti di una macchinetta: somma e numero su tutte le sue bevande
function machineStat(m) {
  let sum = 0, n = 0;
  for (const d of m.drinks) { const s = state.stats.get(keyOf(m.id, d.id)); if (s) { sum += s.sum; n += s.n; } }
  return { n, avg: n ? sum / n : null };
}

// La bevanda migliore di una macchinetta (media corretta; a parità più voti), o null se nessuna ha voti
function bestDrink(m) {
  const C = globalMean();
  let best = null;
  for (const d of m.drinks) {
    const s = state.stats.get(keyOf(m.id, d.id));
    if (!s || !s.n) continue;
    const score = bayesScore(s, C);
    if (!best || score > best.score + 1e-9 || (Math.abs(score - best.score) <= 1e-9 && s.n > best.n)) {
      best = { d, score, n: s.n, avg: s.sum / s.n };
    }
  }
  return best;
}

// Home: i piani restano in ordine (6°, 4°, 3°); dentro lo stesso piano prima la macchinetta con più recensioni;
// a parità l'ordine di prima (principale, poi secondaria)
const floorOf = (m) => parseInt(m.floor, 10); // "6° piano" → 6
function sortedMachines() {
  const st = new Map(MACHINES.map((m) => [m.id, machineStat(m)]));
  return [...FALLBACK_ORDER].sort((a, b) =>
    floorOf(b) - floorOf(a) || st.get(b.id).n - st.get(a.id).n || FALLBACK_ORDER.indexOf(a) - FALLBACK_ORDER.indexOf(b));
}

const open = new Set(); // menù aperti nella home: le medie si leggono solo per queste macchinette

/* ---- Riquadro di una bevanda: nome e, sotto, "★ media · N voti". Tocco = pannello di voto (mostra il mio voto) ----
   Votata: bordo verde continuo. Da votare: bordo tratteggiato e ☆ (la forma del bordo distingue anche senza colore). */
function drinkTile(e, spot) {
  const st = statOf(e.key);
  const voted = state.mine.has(e.key);
  const knows = state.mineLoaded; // finché non so cosa ho votato il riquadro resta neutro
  const b = drinkButton(e, spot, `tile${knows ? (voted ? " is-voted" : " is-todo") : ""}`);
  b.append(el("span", "tile-name", e.d.name));
  if (st.pending) {
    b.append(skel("w-60"));
  } else if (st.known && st.n === 0) {
    b.append(el("span", "tile-sub tile-none", "Nessun voto ancora"));
  } else if (!st.known) {
    b.append(el("span", "tile-sub", "Voti non disponibili"));
  } else {
    // La media di tutti (.score e .avg-num: ci pensano le animazioni dopo un voto)
    const sub = el("span", "tile-sub score");
    sub.append(el("span", "tile-star", "★"), el("span", "avg-num", nfAvg.format(st.avg)), el("span", "tile-n", `· ${votesLabel(st.n)}`));
    b.append(sub);
  }
  if (knows && !voted) {
    const star = el("span", "tile-badge todo", "☆");
    star.setAttribute("aria-hidden", "true"); // il testo per gli screen reader è nell'aria-label del riquadro
    b.append(star);
  }
  // Appena votata: breve alone verde. Dopo un voto la pagina si ridisegna più volte: riprendo l'animazione
  // da dove era (delay negativo), così non si interrompe né riparte da capo.
  const pop = state.pop;
  if (voted && pop && pop.key === e.key) {
    const elapsed = performance.now() - pop.at;
    if (elapsed < 800) {
      b.classList.add("just-voted");
      b.style.animationDelay = `-${Math.round(elapsed)}ms`;
    }
  }
  return b;
}

// Griglia a due colonne come il pannello reale: le prime `leftCount` bevande a sinistra dall'alto in basso, poi la destra
function grid(m, drinks, prefix, rows) {
  const g = el("div", "drink-grid");
  g.style.setProperty("--rows", String(rows));
  for (const d of drinks) {
    const key = keyOf(m.id, d.id);
    g.append(drinkTile({ key, m, d }, `${prefix}:${key}`));
  }
  return g;
}

// Un solo invito in cima alla macchinetta, quando nessuna sua bevanda ha ancora voti
const hasNoVotes = (m) => m.drinks.every((d) => { const s = statOf(keyOf(m.id, d.id)); return s.known && s.n === 0; });

// Le bevande di una macchinetta: invito (se serve) e griglia
function drinksOf(m, prefix) {
  const box = el("div", "drinks");
  if (hasNoVotes(m)) box.append(el("p", "machine-invite", "Diventa il primo a lasciare una recensione"));
  box.append(grid(m, m.drinks, prefix, m.leftCount ?? Math.ceil(m.drinks.length / 2)));
  return box;
}

/* ---- Pagina di una macchinetta (?m=) ---- */
function renderHero(m) {
  const sec = el("section", "hero");
  sec.setAttribute("aria-labelledby", "hero-title");
  sec.append(photo(m, "hero-photo"));
  const head = el("div", "hero-head");
  const h = el("h1", "hero-title", m.name);
  h.id = "hero-title";
  head.append(el("p", "eyebrow", m.floor), h);
  sec.append(head, drinksOf(m, "hero"));
  return sec;
}

function moreLinks() {
  const p = el("p", "more");
  const all = el("a", "more-link", "Vedi tutte le macchinette →");
  all.href = location.pathname; // stessa pagina, senza ?m=
  const rank = el("a", "more-link", "Vai alla classifica →");
  rank.href = "classifica.html";
  p.append(all, rank, refreshButton());
  return p;
}

/* ---- Home: un menù per macchinetta, chiuso finché non lo tocchi ---- */

// "Top: Cappuccino ★ 4,6" sotto il nome, anche a menù chiuso
function topLine(m) {
  const line = el("span", "mcard-top");
  if (m.drinks.some((d) => statOf(keyOf(m.id, d.id)).pending)) { line.append(skel("w-80")); return line; }
  const best = bestDrink(m);
  if (!best) { line.classList.add("none"); line.textContent = "Ancora nessuna recensione"; return line; }
  line.append("Top: ", el("b", "", best.d.name), " ", el("span", "tile-star", "★"), ` ${nfAvg.format(best.avg)}`);
  return line;
}
function machineMenu(m) {
  const isOpen = open.has(m.id);
  const card = el("article", `mcard${isOpen ? " open" : ""}`);
  const head = el("button", "mcard-head");
  head.type = "button";
  head.id = `menu-${m.id}`;
  head.dataset.menu = m.id;
  head.dataset.spot = `menu:${m.id}`;
  head.setAttribute("aria-expanded", String(isOpen));
  head.setAttribute("aria-controls", `panel-${m.id}`);
  const title = el("span", "mcard-title");
  title.append(el("span", "eyebrow", m.floor), el("span", "mcard-name", m.name), topLine(m));
  const chevron = el("span", "chevron");
  chevron.setAttribute("aria-hidden", "true");
  const ms = machineStat(m);
  const rating = el("span", "mcard-rating", ms.n ? votesLabel(ms.n) : "");
  head.append(title, rating, chevron);
  card.append(head);
  if (isOpen) {
    const panel = el("div", "mcard-panel");
    panel.id = `panel-${m.id}`;
    panel.setAttribute("role", "region");
    panel.setAttribute("aria-labelledby", head.id);
    panel.append(photo(m, "mcard-photo"), drinksOf(m, "menu"));
    card.append(panel);
  }
  return card;
}

function renderMachines() {
  const sec = el("section", "page");
  sec.append(pageHead("machines-title", "Le macchinette", "Scegli una macchinetta e dì la tua."));
  const list = el("div", "menus");
  for (const m of sortedMachines()) list.append(machineMenu(m));
  sec.append(list);
  return sec;
}

start({
  page: "home",
  sections: () => (single ? [renderHero(single), moreLinks()] : [renderMachines()]),
  // ?m=: le 3 medie della macchinetta. Home: tutte (servono a ordinare le macchinette)
  need: () => (single ? ENTRIES.filter((e) => e.m === single) : ENTRIES),
});

// Tocco su un menù: apre/chiude
$("#view").addEventListener("click", (ev) => {
  const head = ev.target.closest("[data-menu]");
  if (!head) return;
  const id = head.dataset.menu;
  if (open.has(id)) open.delete(id); else open.add(id);
  renderView();
});

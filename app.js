import {
  start, $, el, keyOf, ENTRIES, statOf, drinkButton, mineLine, skel, scoreBlock, meter, photo,
  pageHead, refreshButton, renderView, loadStats,
} from "./core.js";
import { MACHINES } from "./machines.js";

// ?m=<id>: quella macchinetta in primo piano (id mancante o non valido → home)
const single = MACHINES.find((m) => m.id === new URLSearchParams(location.search).get("m")) ?? null;
if (single) document.title = `${single.name} (${single.floor}) · Kaffa ISILTeP`;

// Ordine dei menù nella home (i dati in machines.js non si toccano): 6° piano, 4° piano, 3° piano
const HOME_ORDER = ["piano6-principale", "piano6-secondaria", "piano4-principale", "piano4-secondaria", "piano3"];
const homeRank = (m) => { const i = HOME_ORDER.indexOf(m.id); return i < 0 ? HOME_ORDER.length : i; };
const HOME_MACHINES = [...MACHINES].sort((a, b) => homeRank(a) - homeRank(b));

const open = new Set(); // menù aperti nella home: le medie si leggono solo per queste macchinette

/* ---- Bevanda: media, stelle e numero di voti; senza voti, un invito a lasciare la prima recensione ---- */
function bigDrink(e, spot) {
  const st = statOf(e.key);
  const empty = st.known && st.n === 0;
  const b = drinkButton(e, spot, `big-drink${empty ? " is-empty" : ""}`);
  const main = el("span", "big-main");
  main.append(el("span", "drink-name", e.d.name));
  if (empty) main.append(el("span", "drink-first", "Diventa il primo a lasciare una recensione"));
  else main.append(st.pending ? skel("w-80") : meter(st.avg), mineLine(e.key));
  const num = el("span", "big-num");
  if (empty) {
    const star = el("span", "drink-plus", "☆");
    star.setAttribute("aria-hidden", "true");
    num.append(star);
  } else {
    num.append(scoreBlock(st));
  }
  b.append(main, num);
  return b;
}

function drinksOf(m, prefix) {
  const list = el("div", "hero-drinks");
  for (const d of m.drinks) {
    const key = keyOf(m.id, d.id);
    list.append(bigDrink({ key, m, d }, `${prefix}:${key}`));
  }
  return list;
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
  title.append(el("span", "eyebrow", m.floor), el("span", "mcard-name", m.name));
  const chevron = el("span", "chevron");
  chevron.setAttribute("aria-hidden", "true");
  head.append(title, chevron);
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
  sec.append(pageHead("machines-title", "Le macchinette", "Tocca una macchinetta per vedere le bevande e votare."));
  const list = el("div", "menus");
  for (const m of HOME_MACHINES) list.append(machineMenu(m));
  sec.append(list);
  return sec;
}

start({
  page: "home",
  sections: () => (single ? [renderHero(single), moreLinks()] : [renderMachines()]),
  // ?m=: le 3 medie della macchinetta. Home: solo quelle dei menù aperti (all'inizio nessuna lettura)
  need: () => (single ? ENTRIES.filter((e) => e.m === single) : ENTRIES.filter((e) => open.has(e.m.id))),
});

// Tocco su un menù: apre/chiude e, aprendo, legge le medie di quella macchinetta
$("#view").addEventListener("click", (ev) => {
  const head = ev.target.closest("[data-menu]");
  if (!head) return;
  const id = head.dataset.menu;
  const opening = !open.has(id);
  if (opening) open.add(id); else open.delete(id);
  renderView();
  if (opening) loadStats().catch(console.error);
});

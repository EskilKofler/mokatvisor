import {
  start, $, el, keyOf, ENTRIES, statOf, drinkButton, mineLine, skel, scoreBlock, meter, photo,
  pageHead, refreshButton,
} from "./core.js";
import { MACHINES } from "./machines.js";

// ?m=<id>: quella macchinetta in primo piano (id mancante o non valido → home)
const single = MACHINES.find((m) => m.id === new URLSearchParams(location.search).get("m")) ?? null;
if (single) document.title = `${single.name} (${single.floor}) · kaffa-isiltep`;

// Ordine delle card nella home (i dati in machines.js non si toccano): 6° piano, 4° piano, 3° piano
const HOME_ORDER = ["piano6-principale", "piano6-secondaria", "piano4-principale", "piano4-secondaria", "piano3"];
const homeRank = (m) => { const i = HOME_ORDER.indexOf(m.id); return i < 0 ? HOME_ORDER.length : i; };
const HOME_MACHINES = [...MACHINES].sort((a, b) => homeRank(a) - homeRank(b));

/* ---- Riga bevanda dentro la card di una macchinetta ---- */
function drinkRow(e, spot) {
  const st = statOf(e.key);
  const b = drinkButton(e, spot, "drink");
  const main = el("span", "drink-main");
  main.append(el("span", "drink-name", e.d.name), mineLine(e.key));
  b.append(main, scoreBlock(st));
  return b;
}

/* ---- Bevanda in grande (vista ?m=) ---- */
function bigDrink(e, spot) {
  const st = statOf(e.key);
  const b = drinkButton(e, spot, "big-drink");
  const main = el("span", "big-main");
  main.append(el("span", "drink-name", e.d.name));
  main.append(st.pending ? skel("w-80") : meter(st.avg), mineLine(e.key));
  const num = el("span", "big-num");
  num.append(scoreBlock(st));
  b.append(main, num);
  return b;
}

function renderHero(m) {
  const sec = el("section", "hero");
  sec.setAttribute("aria-labelledby", "hero-title");
  sec.append(photo(m, "hero-photo"));
  const head = el("div", "hero-head");
  const h = el("h1", "hero-title", m.name);
  h.id = "hero-title";
  head.append(el("p", "eyebrow", m.floor), h);
  const list = el("div", "hero-drinks");
  for (const d of m.drinks) list.append(bigDrink({ key: keyOf(m.id, d.id), m, d }, `hero:${keyOf(m.id, d.id)}`));
  sec.append(head, list);
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

function renderMachines() {
  const sec = el("section", "page");
  sec.append(pageHead("machines-title", "Le macchinette", "Tocca una bevanda per votarla."));
  const grid = el("div", "machines");
  for (const m of HOME_MACHINES) {
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

start({
  page: "home",
  sections: () => (single ? [renderHero(single), moreLinks()] : [renderMachines()]),
  need: () => (single ? ENTRIES.filter((e) => e.m === single) : ENTRIES), // con ?m= bastano le 3 medie della macchinetta
});

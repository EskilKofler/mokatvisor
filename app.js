import {
  start, $, el, keyOf, ENTRIES, withPremiumTag, statOf, drinkButton, skel, photo,
  pageHead, refreshButton, renderView, state, nfAvg, nfVote, votesLabel, globalMean, bayesScore, drinkLabel,
  voteWaitMs, waitMessage,
} from "./core.js";
import { MACHINES, placeOf } from "./machines.js";

// ?m=<id>: quella macchinetta in primo piano (senza distinguere maiuscole/minuscole né spazi ai lati).
// Id mancante → home; id non corrispondente a nessuna macchinetta → home con una riga discreta.
const rawM = new URLSearchParams(location.search).get("m");
const wantedM = rawM?.trim().toLowerCase() ?? "";
const single = MACHINES.find((m) => m.id === wantedM) ?? null;
const notFound = wantedM !== "" && !single;
if (single) document.title = `${placeOf(single)} · Mokatvisor`;

/* ---- Nuove recensioni: solo dalla pagina della macchinetta (?m=<id>) ----
   Dalla home non si lasciano nuove recensioni; le recensioni già date si possono sempre modificare. */
const canVote = (m) => m === single;

// Ordine dei menù nella home (i dati in machines.js non si toccano): 6° piano (prima la secondaria), 4° piano (prima la secondaria),
// Brambillino 1° piano, Brambillino piano terra e, per ultima, quella del 3° piano
const HOME_ORDER = ["sesto-secondaria", "sesto-principale", "quarto-secondaria", "quarto-principale", "brambillino-sopra", "brambillino-sotto", "terzo"];
const homeRank = (m) => { const i = HOME_ORDER.indexOf(m.id); return i < 0 ? HOME_ORDER.length : i; };
const FALLBACK_ORDER = [...MACHINES].sort((a, b) => homeRank(a) - homeRank(b));

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

// Home: ordine fisso (HOME_ORDER), non dipende dai voti
const sortedMachines = () => FALLBACK_ORDER;

const open = new Set(); // menù aperti nella home: le medie si leggono solo per queste macchinette

// Frase per gli screen reader dei riquadri in sola lettura
function readOnlyLabel(e, st) {
  const media = st.pending ? "voti in caricamento"
    : !st.known ? "voti non disponibili"
    : st.n === 0 ? "ancora nessun voto"
    : `media ${nfAvg.format(st.avg)}, ${votesLabel(st.n)}`;
  const my = state.mine.get(e.key);
  return `${drinkLabel(e.d)}, ${placeOf(e.m)}: ${media}.${my === undefined ? "" : ` Il tuo voto: ${nfVote.format(my)}.`} Tocca per i dettagli.`;
}

/* ---- Riquadro di una bevanda: nome e, sotto, "★ media · N voti". Tocco = pannello di voto (mostra il mio voto) ----
   Votata: bordo verde continuo. Da votare: bordo tratteggiato (la forma del bordo distingue anche senza colore). */
function drinkTile(e, spot) {
  const st = statOf(e.key);
  const voted = state.mine.has(e.key);
  const knows = state.mineLoaded; // finché non so cosa ho votato il riquadro resta neutro
  // Nuova recensione non permessa qui (macchinetta non sbloccata) oppure attesa dopo l'ultima nuova recensione:
  // niente stile "da votare", il tocco apre il pannello con i risultati. Chi ha già votato può sempre modificare.
  const locked = !canVote(e.m) && !voted;
  const plain = locked || (!voted && voteWaitMs() > 0);
  const b = drinkButton(e, spot, `tile${locked ? " ro" : ""}${knows ? (voted ? " is-voted" : plain ? "" : " is-todo") : ""}`);
  if (plain) b.setAttribute("aria-label", readOnlyLabel(e, st));
  // nomi lunghi: carattere un po' più piccolo; le varianti premium hanno il tag PREMIUM
  b.append(withPremiumTag(el("span", `tile-name${e.d.name.length >= 23 ? " long" : ""}`, e.d.name), e.d));
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

// Griglia a due colonne come il pannello reale, con posizione ESPLICITA (grid-row / grid-column): un posto vuoto
// (null in machines.js) resta vuoto e non fa scorrere le altre bevande. Ordine nel DOM: colonna sinistra dall'alto
// in basso, poi la destra (anche per tastiera e screen reader).
function grid(m, prefix) {
  const g = el("div", "drink-grid");
  g.style.setProperty("--rows", String(m.rows.length));
  for (const col of [0, 1]) {
    m.rows.forEach((row, i) => {
      const d = row[col];
      if (!d) return; // posto vuoto: nessun riquadro, nessun testo
      const key = keyOf(m.id, d.id);
      const tile = drinkTile({ key, m, d }, `${prefix}:${key}`);
      tile.style.gridRow = String(i + 1);
      tile.style.gridColumn = String(col + 1);
      g.append(tile);
    });
  }
  return g;
}

// Un solo invito in cima alla macchinetta, quando nessuna sua bevanda ha ancora voti
const hasNoVotes = (m) => m.drinks.every((d) => { const s = statOf(keyOf(m.id, d.id)); return s.known && s.n === 0; });

// Le bevande di una macchinetta: invito (se serve) e griglia
function drinksOf(m, prefix) {
  const box = el("div", "drinks");
  if (canVote(m) && hasNoVotes(m)) box.append(el("p", "machine-invite", "Diventa il primo a lasciare una recensione"));
  box.append(grid(m, prefix));
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
  head.append(el("p", "eyebrow", m.floor ?? ""), h);
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
  // stella e numero vanno a capo insieme (mai la stella da sola in fondo a una riga)
  const score = el("span", "top-score");
  score.append(el("span", "tile-star", "★"), ` ${nfAvg.format(best.avg)}`);
  line.append("Top: ", withPremiumTag(el("b", "", best.d.name), best.d), " ", score);
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
  title.append(el("span", "eyebrow", m.floor ?? ""), el("span", "mcard-name", m.name), topLine(m));
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
  // Una riga che spiega dove si vota
  const head = pageHead("machines-title", "Macchinette dell'ISILTeP",
    "Qui vedi i risultati. Per votare, scansiona il QR sulla macchinetta dove hai preso il caffè: ogni macchinetta ha il suo.");
  head.querySelector(".section-sub")?.classList.add("ro-note");
  sec.append(head);
  if (notFound) sec.append(el("p", "section-sub ro-note", "Macchinetta non trovata: ecco tutte le altre"));
  const list = el("div", "menus");
  for (const m of sortedMachines()) list.append(machineMenu(m));
  sec.append(list);
  return sec;
}

/* ---- Pannello di sola lettura: media, numero di voti, il mio voto (se c'è) e come si vota ---- */
const SVG_NS = "http://www.w3.org/2000/svg";
function qrIcon() {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "ro-qr-icon");
  svg.setAttribute("aria-hidden", "true");
  for (const [x, y, w] of [[3, 3, 7], [14, 3, 7], [3, 14, 7], [14, 14, 3], [18, 18, 3]]) {
    const r = document.createElementNS(SVG_NS, "rect");
    r.setAttribute("x", x); r.setAttribute("y", y); r.setAttribute("width", w); r.setAttribute("height", w);
    r.setAttribute("rx", w > 3 ? "1.5" : "0.5");
    if (w > 3) { r.setAttribute("fill", "none"); r.setAttribute("stroke", "currentColor"); r.setAttribute("stroke-width", "2"); }
    else r.setAttribute("fill", "currentColor");
    svg.append(r);
  }
  return svg;
}

function clockIcon() {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "ro-qr-icon");
  svg.setAttribute("aria-hidden", "true");
  const c = document.createElementNS(SVG_NS, "circle");
  c.setAttribute("cx", "12"); c.setAttribute("cy", "12"); c.setAttribute("r", "9");
  const h = document.createElementNS(SVG_NS, "path");
  h.setAttribute("d", "M12 7v5l3 2");
  for (const n of [c, h]) { n.setAttribute("fill", "none"); n.setAttribute("stroke", "currentColor"); n.setAttribute("stroke-width", "2"); n.setAttribute("stroke-linecap", "round"); n.setAttribute("stroke-linejoin", "round"); svg.append(n); }
  return svg;
}

let roSheet, roSpot = null;
function closeReadOnly() {
  if (!roSheet?.open) return;
  if (typeof roSheet.close === "function") roSheet.close(); else roSheet.removeAttribute("open");
  // Il ridisegno può aver sostituito il bottone: rimetto il focus dove era
  if (roSpot) $("#view").querySelector(`[data-spot="${roSpot}"]`)?.focus({ preventScroll: true });
  roSpot = null;
}
function buildReadOnly() {
  roSheet = el("dialog", "sheet");
  roSheet.tabIndex = -1;
  roSheet.setAttribute("aria-labelledby", "ro-title");
  const inner = el("div", "sheet-in");
  const title = el("h2", "sheet-title"); title.id = "ro-title";
  const qr = el("p", "ro-qr");
  qr.id = "ro-note";
  inner.append(
    el("div", "sheet-grip"), Object.assign(el("p", "eyebrow"), { id: "ro-eyebrow" }), title,
    Object.assign(el("p", "sheet-sub"), { id: "ro-sub" }),
    Object.assign(el("p", "ro-score"), { id: "ro-score" }),
    Object.assign(el("p", "sheet-prev"), { id: "ro-mine" }),
    qr,
  );
  roSheet.append(inner);
  roSheet.addEventListener("cancel", (ev) => { ev.preventDefault(); closeReadOnly(); }); // tasto Esc
  roSheet.addEventListener("click", (ev) => { if (ev.target === roSheet) closeReadOnly(); }); // tocco sullo sfondo
  document.body.append(roSheet);
}
// kind: "qr" (nuova recensione solo con il QR) oppure "wait" (attesa tra due recensioni)
function openReadOnly(e, spot, kind) {
  if (!roSheet) buildReadOnly();
  roSpot = spot;
  const st = statOf(e.key);
  $("#ro-eyebrow").textContent = e.m.floor ?? "";
  const title = $("#ro-title");
  title.textContent = e.d.name; // azzera anche il tag della bevanda precedente
  withPremiumTag(title, e.d);
  $("#ro-sub").textContent = e.m.name;
  const score = $("#ro-score");
  score.replaceChildren();
  if (st.known && st.n > 0) {
    score.append(el("span", "ro-num", nfAvg.format(st.avg)), el("span", "ro-star", "★"), el("span", "ro-n", `· ${votesLabel(st.n)}`));
  } else {
    score.append(el("span", "ro-n ro-empty", st.pending ? "Caricamento…" : st.known ? "Nessun voto ancora" : "Voti non disponibili"));
  }
  const my = state.mine.get(e.key);
  $("#ro-note").replaceChildren(
    kind === "qr" ? qrIcon() : clockIcon(),
    el("span", "", kind === "qr" ? "Per votare, scansiona il QR sulla macchinetta" : waitMessage(voteWaitMs())),
  );
  $("#ro-mine").textContent = my === undefined ? "" : `Il tuo voto: ${nfVote.format(my)} ★`;
  if (typeof roSheet.showModal === "function") roSheet.showModal(); else roSheet.setAttribute("open", "");
  roSheet.focus({ preventScroll: true });
}

// Tocco su una bevanda di una macchinetta in sola lettura: apre il pannello dei risultati.
// Ascolto in fase di cattura, così il pannello di voto (core.js) non si apre.
$("#view").addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-key]");
  if (!b) return;
  const e = ENTRIES.find((x) => x.key === b.dataset.key);
  if (!e) return;
  const voted = state.mine.has(e.key);
  const locked = !canVote(e.m) && !voted;
  if (voted || (!locked && voteWaitMs() === 0)) return; // si può votare o modificare: apre il pannello di voto (core.js)
  ev.stopPropagation();
  openReadOnly(e, b.dataset.spot, locked ? "qr" : "wait");
}, true);

// Finita l'attesa tra due recensioni i riquadri tornano da soli come prima
let repaintTimer = 0;
function scheduleRepaint() {
  clearTimeout(repaintTimer);
  const wait = voteWaitMs();
  if (wait > 0) repaintTimer = setTimeout(renderView, wait + 300);
}

start({
  page: "home",
  sections: () => { scheduleRepaint(); return single ? [renderHero(single), moreLinks()] : [renderMachines()]; },
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

import {
  start, el, ENTRIES, state, statOf, skel, scoreNum, scoreBlock, nfAvg, votesLabel, refreshLink, globalMean, bayesScore,
} from "./core.js";

/* ------------------------------------------------------------------ */
/*  IMPOSTAZIONI DELLA CLASSIFICA                                      */
/* ------------------------------------------------------------------ */
const MIN_VOTES = 1;   // voti minimi perché una bevanda entri nel podio e nella classifica "vera"
// (PRIOR_VOTES, il peso della media generale nella media corretta, sta in core.js)

/* ------------------------------------------------------------------ */

const MEDALS = ["🥇", "🥈", "🥉"];
const PLACES = ["Primo", "Secondo", "Terzo"];

// Ordina con la media corretta (bayesiana); a schermo c'è sempre la media vera e il numero di voti
function rankedList() {
  const C = globalMean();
  return ENTRIES.map((e) => {
    const st = statOf(e.key);
    return { ...e, ...st, eligible: st.n >= MIN_VOTES, score: bayesScore(state.stats.get(e.key), C) };
  });
}

const group = (r) => (r.eligible ? 0 : r.n ? 1 : 2); // classifica vera, pochi voti, nessun voto
const r6 = (x) => Math.round((x ?? -1) * 1e6); // a 6 decimali: niente falsi pareggi per errori di virgola mobile
// Ordine: punteggio corretto; a parità, più voti; poi ordine fisso
const byScore = (a, b) =>
  group(a) - group(b) || r6(b.score) - r6(a.score) || b.n - a.n || a.key.localeCompare(b.key);
const allPending = () => ENTRIES.some((e) => statOf(e.key).pending);

// Frase di lettura per gli screen reader: la pagina mostra soltanto, non si vota da qui
const describe = (r) =>
  `${r.d.name}, ${r.m.name} (${r.m.floor}): ${r.avg == null ? "nessun voto" : `media ${nfAvg.format(r.avg)}, ${votesLabel(r.n)}`}`;

/* ---- Podio ---- */

function podItem(r, i) {
  const b = el("div", `pod p${i + 1}`);
  b.dataset.drink = r.key;
  b.setAttribute("role", "group");
  b.setAttribute("aria-label", `${PLACES[i]} posto. ${describe(r)}`);
  const medal = el("span", "medal", MEDALS[i]);
  medal.setAttribute("aria-hidden", "true");
  const where = el("span", "pod-where");
  where.append(el("span", "", r.m.name), el("span", "", r.m.floor));
  const top = el("span", "pod-top");
  top.append(medal, el("span", "pod-name", r.d.name), where);
  const score = el("span", "pod-score");
  score.append(scoreNum(r.avg), el("span", "pod-n", votesLabel(r.n)));
  b.append(top, score);
  return b;
}

function podEmpty(i, loading) {
  const d = el("div", `pod p${i + 1} empty`);
  d.setAttribute("aria-hidden", loading ? "true" : "false");
  const medal = el("span", "medal", MEDALS[i]);
  medal.setAttribute("aria-hidden", "true");
  const top = el("span", "pod-top");
  top.append(medal);
  if (loading) top.append(skel("w-80"), skel("w-60"));
  else top.append(el("span", "pod-name", "Posto libero"), el("span", "pod-where", "Vota per portarla qui"));
  d.append(top);
  return d;
}

/* ---- Elenco: dal 4° posto in giù ---- */

function rankRow(r, pos) {
  const b = el("div", `rank-row${r.eligible ? "" : " dim"}`);
  b.dataset.drink = r.key;
  b.setAttribute("role", "group");
  b.setAttribute("aria-label", `${pos ? `${pos}° posto. ` : ""}${describe(r)}`);
  const p = el("span", "rank-pos", pos ? String(pos) : "–");
  p.setAttribute("aria-hidden", "true");
  const name = el("span", "rank-top");
  name.append(el("span", "drink-name", r.d.name), el("span", "rank-where", `${r.m.name} · ${r.m.floor}`));
  const bar = el("span", "bar");
  bar.setAttribute("aria-hidden", "true");
  const fill = document.createElement("i");
  fill.style.width = `${((r.avg ?? 0) / 5) * 100}%`;
  bar.append(fill);
  b.append(p, name, scoreBlock(r), bar);
  return b;
}

function ghostRow() {
  const li = el("li", "rank-row ghost");
  li.setAttribute("aria-hidden", "true");
  li.append(skel("w-40"), skel("w-80"), skel("w-40 tall"));
  return li;
}

/* ---- Pagina ---- */

// "↻ Aggiorna i risultati" piccolo e grigio in fondo alla pagina
function refreshRow() {
  const p = el("p", "refresh-row");
  p.append(refreshLink());
  return p;
}

function renderBoard() {
  const sec = el("section", "page");
  sec.setAttribute("aria-labelledby", "rank-title");
  // Il titolo non si vede, ma resta per chi usa uno screen reader
  const h1 = el("h1", "sr-only", "Classifica");
  h1.id = "rank-title";
  sec.append(h1);

  // Dati in arrivo: scheletri
  if (allPending()) {
    const pod = el("div", "podium");
    for (let i = 0; i < 3; i++) pod.append(podEmpty(i, true));
    const ol = el("ol", "rank");
    for (let i = 0; i < 6; i++) ol.append(ghostRow());
    sec.append(pod, ol);
    return sec;
  }

  const sorted = rankedList().sort(byScore);

  // Nessun voto in tutto il sito: invito a votare
  if (!sorted.some((r) => r.n > 0)) {
    const inv = el("div", "invite");
    const go = el("a", "btn", "Vai alle macchinette");
    go.href = "./";
    inv.append(
      el("p", "invite-title", "Ancora nessuna recensione"),
      el("p", "invite-text", "Scegli una bevanda e lascia la prima: la classifica parte da qui."),
      go,
    );
    sec.append(inv, refreshRow());
    return sec;
  }

  const top = sorted.filter((r) => r.eligible).slice(0, 3);
  const pod = el("div", "podium");
  for (let i = 0; i < 3; i++) pod.append(top[i] ? podItem(top[i], i) : podEmpty(i, false));

  const ol = el("ol", "rank");
  sorted.forEach((r, i) => {
    if (top.includes(r)) return;
    const li = el("li");
    li.append(rankRow(r, r.eligible ? i + 1 : null));
    ol.append(li);
  });
  sec.append(pod);
  if (ol.children.length) sec.append(ol);
  sec.append(refreshRow());
  return sec;
}

start({ page: "rank", vote: false, sections: () => [renderBoard()] });

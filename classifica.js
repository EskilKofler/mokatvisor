import {
  start, el, ENTRIES, state, statOf, drinkButton, skel, scoreNum, scoreBlock, ariaFor, votesLabel,
  sectionHead, pageHead,
} from "./core.js";

/* ------------------------------------------------------------------ */
/*  IMPOSTAZIONI DELLA CLASSIFICA                                      */
/* ------------------------------------------------------------------ */
const MIN_VOTES = 1;   // voti minimi perché una bevanda entri nel podio e nella classifica "vera"
const PRIOR_VOTES = 1; // voti "virtuali" della media generale nella media corretta (bayesiana): piccolo = conta poco

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
const r6 = (x) => Math.round((x ?? -1) * 1e6); // a 6 decimali: niente falsi pareggi per errori di virgola mobile
// Ordine: punteggio corretto; a parità, più voti; poi ordine fisso
const byScore = (a, b) =>
  group(a) - group(b) || r6(b.score) - r6(a.score) || b.n - a.n || a.key.localeCompare(b.key);
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
  else body.append(el("span", "pod-name", "Posto libero"), el("span", "pod-where", "Vota per portarla qui"));
  d.append(medal, body);
  return d;
}

function renderTop3() {
  const sec = el("section", "section");
  sec.setAttribute("aria-labelledby", "top3-title");
  sec.append(...sectionHead("top3-title", "🏆 Top 3 di sempre", MIN_VOTES > 1 ? `Contano le bevande con almeno ${MIN_VOTES} voti.` : "Basta anche un solo voto per entrare."));
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
      el("p", "invite-text", "Scegli la tua bevanda preferita e dai il primo voto: il podio parte da qui!"),
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
  main.append(top, bar);
  b.append(p, main, scoreBlock(r));
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

start({
  page: "rank",
  sections: () => [pageHead("rank-title", "Classifica", "Le bevande più apprezzate."), renderTop3(), renderRanking()],
});

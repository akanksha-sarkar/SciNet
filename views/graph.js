import { load, fmt, makeTypeColor } from "../data.js";
import { mergeEdges, pickMinDegree, DEGREE_STEPS, orderTypes, pickEvidenceNumber } from "./graph-model.js";

// Ported from the pre-prune dashboard's SVG graph: a deterministic left→right
// column layout by entity type, an ego-network focus, relation-colored edges,
// and a panel that shows the claims behind each edge (clickable through to
// the Claims view). No force sim — legibility over motion.
//
// A fresh visit is an OVERVIEW, not the whole graph: nodes below an
// auto-picked degree cut are hidden (most graphs are >60% degree-1 leaves)
// so the canvas stays a screen or two tall. A domain may pin the opening cut
// instead (graph.json `min_degree`, from domain.toml [dashboard]). The cut is
// a toolbar control and a URL param; focus and search always look at every node.

const esc = (s) =>
  (s || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

// A quantity label on a relation button competes for room with the two node
// names; past ~24 characters it pushes the relation off the line.
const clip = (s, n = 24) =>
  (s || "").length > n ? `${(s || "").slice(0, n - 1)}\u2026` : s || "";

const REL_PALETTE = ["#2a78d6", "#0ca30c", "#e8830f", "#a05cc8", "#d03b3b", "#0aa5a5", "#c2185b", "#7a8b1f", "#5c6bc0", "#26a69a", "#8d6e63"];
const CAP = 140; // bounds only the focused ego view (one node's neighbour list); the default view renders every node.
const COL_MIN_W = 150; // min horizontal room per column; canvas scrolls past it
// Layout geometry is derived from the data, not fixed: a column is as wide as
// its longest label and a row as tall as its circle, so 800-node graphs with
// 100-char ids stay legible instead of overlapping (canvas scrolls both ways).
const LABEL_MAX = 30; // chars shown beside a node; the full id stays in the <title>
const HEAD_CHAR_W = 10; // ~px per char of the 12px uppercase bold column header
const ROW_GAP = 6; // vertical gap between neighbouring circles in a column
const ROW_MIN_R = 9; // a row is never shorter than the label line, even at r=4
const ROW_SPREAD_MAX = 40; // extra px per row when a short column is spread to fill the height
const EDGE_FADE_FROM = 300; // above this many edges, edge opacity scales down (floor 0.15)
const DENSE_FROM = 600; // above this many edges, hover transitions are off (animating thousands of opacities lags)
const SAME_COL_BOW_MAX = 220; // same-column arcs bow left in proportion to their span, up to this many px
const humanize = (t) => (t || "untyped").replace(/_/g, " ");
const shortId = (id) => (id.length > LABEL_MAX ? id.slice(0, LABEL_MAX - 1) + "\u2026" : id);
// Estimated label width at the 11px font (measured: caps/digits ~8px, lowercase ~6.5px).
const textW = (str) => [...str].reduce((w, ch) => w + (/[a-z]/.test(ch) ? 6.5 : 8), 0);

export async function render(root, params = {}) {
  const graph = await load("graph");
  const claims = await load("claims");
  const meta = await load("meta").catch(() => ({}));
  const claimById = new Map(claims.map((c) => [c.id, c]));
  const nodeById = new Map(graph.nodes.map((n) => [n.id, n]));
  // An organism-qualified canonical (HB@7227) is shown by its display label
  // (HB (Drosophila melanogaster)) when the build exported one; the id stays
  // the key for data-id, focus, and links.
  const labelOf = (id) => (nodeById.get(id) || {}).label || id;
  const edges = graph.edges.map((e) => ({
    subject: e.source, object: e.target, relation: e.relation, layer: e.layer, claim_id: e.claim_id,
  }));
  // Opt-in edge qualifiers (a relation's glossary declares them) are per
  // claim, but mergeEdges folds claims into one line, so keep them by
  // claim + triple and read them back for every claim behind a drawn edge.
  // A mapped system_id is shown by its declared label (systems.json is
  // fetched only when some edge carries one); system_id null means the
  // domain's systems layer matched no system, shown as "<phrase> (unmapped)".
  // A missing system_id is different: build_kg.apply_qualifiers sets the key
  // only when the domain declares a systems layer, and build_dashboard
  // exports it only when the kept row has it. So no key means there was no
  // layer to map against, and the phrase is shown bare, not as a failed map.
  // One claim can yield several edges on the same triple (two systems, say),
  // so each key holds a list.
  const sysLabel = {};
  if (graph.edges.some((e) => e.system_id)) {
    const sys = await load("systems").catch(() => null);
    (sys?.systems || []).forEach((s) => (sysLabel[s.id] = s.label));
  }
  const qualKey = (cid, e) => `${cid}\t${e.subject}\t${e.relation}\t${e.object}`;
  const qualByKey = new Map();
  graph.edges.forEach((e) => {
    const q = e.qualifiers || {};
    const parts = Object.keys(q).filter((k) => k !== "system").map((k) => `${k}: ${q[k]}`);
    const sys = e.system_id
      ? sysLabel[e.system_id] || e.system_id
      : q.system && e.system_id === null ? `${q.system} (unmapped)` : q.system;
    if (sys) parts.push(`system: ${sys}`);
    if (!parts.length) return;
    const key = qualKey(e.claim_id, { subject: e.source, relation: e.relation, object: e.target });
    if (!qualByKey.has(key)) qualByKey.set(key, []);
    qualByKey.get(key).push(parts.join("; "));
  });
  // Plain text (callers esc() it): the distinct qualifier strings of every
  // edge folded into a merged edge, "" when none carry any.
  const qualText = (e) =>
    [...new Set((e.claim_ids || [e.claim_id]).flatMap((cid) => qualByKey.get(qualKey(cid, e)) || []))].join(" | ");

  const relColor = {};
  const relations = [...new Set(edges.map((e) => e.relation))];
  relations.forEach((r, i) => (relColor[r] = REL_PALETTE[i % REL_PALETTE.length]));
  const layers = [...new Set(edges.map((e) => e.layer))].sort();
  // Columns are generated from the entity types present, ordered by total
  // degree (most-connected types leftmost) unless the domain's own data
  // declares a reading order (meta.graph.column_order) — no hardcoded
  // per-domain layout, the order is data the domain declares.
  const typeDegree = {};
  graph.nodes.forEach((n) => {
    const t = n.type || "untyped";
    typeDegree[t] = (typeDegree[t] || 0) + (n.degree || 0);
  });
  const types = orderTypes(
    [...new Set(graph.nodes.map((n) => n.type || "untyped"))],
    typeDegree,
    meta.graph?.column_order,
  );
  const colIndex = new Map(types.map((t, i) => [t, i]));
  const typeColor = makeTypeColor(types);

  const autoDeg = graph.min_degree > 0 ? graph.min_degree : pickMinDegree(graph.nodes, graph.edges);
  const paramDeg = parseInt(params.deg, 10);
  const state = {
    focus: params.focus && nodeById.has(params.focus) ? params.focus : "",
    type: params.type || "",
    layer: params.layer || "",
    rel: params.rel || "",
    q: params.q || "",
    deg: paramDeg > 0 ? paramDeg : autoDeg,
  };
  const degSteps = DEGREE_STEPS.includes(state.deg) ? DEGREE_STEPS : [...DEGREE_STEPS, state.deg].sort((a, b) => a - b);
  const nodeType = (id) => (nodeById.get(id) || {}).type || "untyped";
  const nodeDeg = (id) => (nodeById.get(id) || {}).degree || 0;
  // The degree cut only shapes the overview: a focused node shows its whole
  // neighbourhood and a search matches every node, leaves included.
  const activeCut = () => (state.focus || state.q ? 1 : state.deg);
  const columnOf = (n) => colIndex.get(n.type || "untyped") ?? 0;
  // Area grows with degree (sqrt), so hubs stand out without every degree-8
  // node hitting the cap and doubling the column height.
  const nodeRadius = (deg) => Math.max(4, Math.min(16, 4 + 1.6 * Math.sqrt(deg || 0)));

  function edgePass(e, cut) {
    if (cut > 1 && (nodeDeg(e.subject) < cut || nodeDeg(e.object) < cut)) return false;
    if (state.layer && e.layer !== state.layer) return false;
    if (state.rel && e.relation !== state.rel) return false;
    if (state.type && nodeType(e.subject) !== state.type && nodeType(e.object) !== state.type) return false;
    if (state.q) {
      const q = state.q.toLowerCase();
      if (!`${e.subject} ${e.object} ${e.relation}`.toLowerCase().includes(q)) return false;
    }
    return true;
  }

  function egoComponent(es, focusId) {
    const deg = {};
    es.forEach((e) => {
      deg[e.subject] = (deg[e.subject] || 0) + 1;
      deg[e.object] = (deg[e.object] || 0) + 1;
    });
    const keep = { [focusId]: true };
    es.forEach((e) => {
      if (e.subject === focusId) keep[e.object] = true;
      if (e.object === focusId) keep[e.subject] = true;
    });
    let ids = Object.keys(keep);
    const total = ids.length;
    if (ids.length > CAP) {
      ids = ids.filter((i) => i !== focusId).sort((a, b) => (deg[b] || 0) - (deg[a] || 0)).slice(0, CAP - 1);
      ids.push(focusId);
    }
    const set = new Set(ids);
    const keptEdges = es.filter((e) => set.has(e.subject) && set.has(e.object));
    const nodes = ids.map((id) => nodeById.get(id) || { id, type: "untyped", degree: 0 });
    return { nodes, edges: keptEdges, truncated: total > CAP, total, ego: focusId };
  }

  function fullView(es) {
    const present = new Set();
    es.forEach((e) => { present.add(e.subject); present.add(e.object); });
    const ids = [...present];
    const nodes = ids.map((id) => nodeById.get(id) || { id, type: "untyped", degree: 0 });
    return { nodes, edges: es, truncated: false, total: ids.length };
  }

  function sub() {
    const cut = activeCut();
    // Filter the per-claim edges first (layer is per claim), then fold the
    // survivors so one drawn line stands for every claim behind a triple.
    const es = mergeEdges(edges.filter((e) => edgePass(e, cut)));
    return state.focus && nodeById.has(state.focus) ? egoComponent(es, state.focus) : fullView(es);
  }

  // --- shell ---
  const opts = (list, sel, lbl) =>
    list.map((v) => `<option value="${esc(v)}"${v === sel ? " selected" : ""}>${esc(lbl ? lbl(v) : v)}</option>`).join("");
  const degLabel = (k) => (k === 1 ? "All nodes" : `Degree ≥ ${k}`);
  root.innerHTML = `
    <div style="padding:16px 24px 0">
      <div class="toolbar">
        <select id="gf-deg" title="Hide nodes with fewer relations than this">${opts(degSteps.map(String), String(state.deg), (v) => degLabel(+v))}</select>
        <select id="gf-type"><option value="">All types</option>${opts(types, state.type)}</select>
        <select id="gf-rel"><option value="">All relations</option>${opts(relations, state.rel)}</select>
        <select id="gf-layer"><option value="">All layers</option>${opts(layers, state.layer)}</select>
        <input type="search" id="gf-q" placeholder="Filter by entity or relation…" value="${esc(state.q)}" style="min-width:200px"/>
        <button class="btn" id="gf-reset">Reset</button>
        <span class="muted mono" id="g-count"></span>
      </div>
      <div class="legend" id="g-legend"></div>
      <div class="legend" id="g-edge-legend"></div>
    </div>
    <div class="graph-wrap">
      <div class="graph-scroll" id="graph-canvas"></div>
      <aside class="inspector" id="g-panel"></aside>
    </div>`;

  // Node legend (dot swatch = entity type) and edge legend (line swatch =
  // relation). Edge colors are otherwise undocumented on the canvas. Hovering
  // a relation chip lights up every edge of that relation (and its endpoints)
  // on the current canvas; the legend sits above the scrolling canvas, so it
  // stays reachable wherever the user has scrolled to.
  root.querySelector("#g-legend").innerHTML =
    `<span class="legend-label">Nodes</span>` +
    types
      .map((t) => `<span class="chip"><span class="dot" style="background:${typeColor(t)}"></span>${esc(humanize(t))}</span>`)
      .join("");
  root.querySelector("#g-edge-legend").innerHTML =
    `<span class="legend-label">Edges</span>` +
    relations
      .map((r) => `<span class="chip chip-rel" data-rel="${esc(r)}" title="Highlight ${esc(humanize(r))} edges"><span class="edge-swatch" style="background:${relColor[r]}"></span>${esc(humanize(r))}</span>`)
      .join("");
  for (const chip of root.querySelectorAll("#g-edge-legend .chip-rel")) {
    const rel = chip.getAttribute("data-rel");
    chip.addEventListener("mouseenter", () => { const svg = canvas.querySelector(".graph-svg"); if (svg) highlightRel(svg, rel); });
    chip.addEventListener("mouseleave", () => { const svg = canvas.querySelector(".graph-svg"); if (svg) clearHi(svg); });
  }

  const canvas = root.querySelector("#graph-canvas");
  const panel = root.querySelector("#g-panel");

  function renderSVG(s, availW) {
    const padY = 46, cols = types.length;
    const byCol = Array.from({ length: cols }, () => []);
    s.nodes.forEach((n) => byCol[columnOf(n)].push(n));
    // Same-column arcs bow LEFT of their column; the leftmost drawn column
    // needs room for them (a quadratic arc reaches half its control offset).
    const firstCol = byCol.findIndex((list) => list.length);
    const leftArcs = s.edges.some((e) => columnOf(nodeById.get(e.subject) || {}) === firstCol
      && columnOf(nodeById.get(e.object) || {}) === firstCol && e.subject !== e.object);
    const padX = 24 + (leftArcs ? SAME_COL_BOW_MAX / 2 : 0);
    // Column width = widest label beside the biggest circle, or the header,
    // whichever is wider. Columns stretch evenly when the graph is narrower
    // than the canvas; otherwise the canvas scrolls horizontally. Types with
    // no node under the current focus/filters take no room (order is kept).
    const geom = byCol.map((list, ci) => {
      if (!list.length) return { rMax: 0, w: 0 };
      const rMax = list.reduce((m, n) => Math.max(m, nodeRadius(n.degree)), 6);
      const labelW = list.reduce((m, n) => Math.max(m, textW(shortId(labelOf(n.id)))), 0);
      const headW = humanize(types[ci]).length * HEAD_CHAR_W;
      return { rMax, w: Math.max(COL_MIN_W, rMax * 2 + 6 + labelW + 24, headW + 16) };
    });
    const used = geom.filter((g) => g.w).length;
    const needW = padX * 2 + geom.reduce((sum, g) => sum + g.w, 0);
    const stretch = needW < availW ? (availW - needW) / used : 0;
    const W = Math.ceil(Math.max(needW, availW));
    let x = padX;
    geom.forEach((g) => { if (g.w) { g.x = x + g.rMax; x += g.w + stretch; } });
    // Row height = the circle's own diameter (never less than the label line)
    // plus a gap, so labels never sit on a neighbour. Short columns spread
    // out a little, capped so a 3-node column does not span the canvas.
    const rowH = (n) => Math.max(nodeRadius(n.degree), ROW_MIN_R) * 2 + ROW_GAP;
    const colH = byCol.map((list) => list.reduce((h, n) => h + rowH(n), 0));
    const H = Math.ceil(Math.max(440, padY * 2 + Math.max(...colH)));
    const pos = {};
    byCol.forEach((list, ci) => {
      list.sort((a, b) => (b.degree || 0) - (a.degree || 0));
      const extra = list.length ? Math.min(ROW_SPREAD_MAX, (H - 2 * padY - colH[ci]) / list.length) : 0;
      let y = padY;
      list.forEach((node) => {
        const h = rowH(node) + extra;
        pos[node.id] = { x: geom[ci].x, y: y + h / 2 };
        y += h;
      });
    });
    const headers = types.map((label, ci) => geom[ci].w
      ? `<text class="g-col-head" x="${geom[ci].x - geom[ci].rMax}" y="22" text-anchor="start">${esc(humanize(label))}</text>`
      : "").join("");
    const edgeSvg = s.edges.map((e, idx) => {
      const a = pos[e.subject], b = pos[e.object];
      if (!a || !b) return "";
      // Same-column edges bow out to the left so they clear the labels, which
      // sit to the right of the circles. The bow grows with the span so long
      // and short arcs separate instead of stacking into one bundle.
      const bow = a.x === b.x ? -Math.min(SAME_COL_BOW_MAX, 20 + Math.abs(b.y - a.y) * 0.35) : 0;
      const mx = (a.x + b.x) / 2 + bow, my = (a.y + b.y) / 2 - Math.abs(b.y - a.y) * 0.12 - 14;
      // Line weight grows with the number of claims folded into the edge (capped so a 20-claim edge is not a bar).
      const w = (1.6 + 0.8 * (Math.min(e.weight, 6) - 1)).toFixed(1);
      const claims = e.weight > 1 ? ` (${e.weight} claims)` : "";
      const quals = qualText(e);
      const qual = quals ? ` — ${esc(quals)}` : "";
      return `<path class="g-edge" data-i="${idx}" data-s="${esc(e.subject)}" data-o="${esc(e.object)}" data-rel="${esc(e.relation)}" d="M${a.x},${a.y} Q${mx},${my} ${b.x},${b.y}" fill="none" stroke="${relColor[e.relation]}" style="--w:${w}"><title>${esc(labelOf(e.subject))} ${esc(e.relation)} ${esc(labelOf(e.object))}${claims}${qual}</title></path>`;
    }).join("");
    const nodeSvg = s.nodes.map((n) => {
      const p = pos[n.id], r = nodeRadius(n.degree);
      return `<g class="g-node" data-id="${esc(n.id)}" tabindex="0" role="button"><title>${esc(labelOf(n.id))} — ${esc(n.type)}, degree ${fmt(n.degree || 0)}</title><circle cx="${p.x}" cy="${p.y}" r="${r}" fill="${typeColor(n.type)}"></circle><text x="${p.x + r + 5}" y="${p.y}" dy="0.35em" text-anchor="start">${esc(shortId(labelOf(n.id)))}</text></g>`;
    }).join("");
    // Dense graphs fade their edges so the canvas is not a solid wall of lines; hover still lifts a node's own edges to full.
    const alpha = Math.max(0.15, Math.min(0.55, 0.55 * (EDGE_FADE_FROM / s.edges.length))).toFixed(2);
    const dense = s.edges.length > DENSE_FROM ? " dense" : "";
    return `<svg class="graph-svg${dense}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="--edge-alpha:${alpha}">${headers}${edgeSvg}${nodeSvg}</svg>`;
  }

  // Conditions (experiment.system/perturbation/measurement) and numbers
  // (quantity = value) behind a claim, so "hosts superconductivity" shows
  // the material/temperature/twist-angle it was measured at, not just the
  // bare relation.
  function evidenceLine(c) {
    const conditions = [c.experiment?.system, c.experiment?.perturbation, c.experiment?.measurement]
      .filter(Boolean).map(esc).join(" · ");
    // A number with no label, or a label with no value, must not render as
    // " = " or "null = null": keep only the parts that are actually there.
    const numbers = (c.numbers || [])
      .map((v) => [v && v.quantity, v && v.value].filter(Boolean).map(esc).join(" = "))
      .filter(Boolean)
      .join(" · ");
    if (!conditions && !numbers) return "";
    return `<div class="g-evidence">${conditions}${conditions && numbers ? "<br>" : ""}${numbers}</div>`;
  }

  // One block per claim folded into the edge: adjudicated text, first quote, links.
  function claimBlock(cid, n, total) {
    const c = claimById.get(cid) || {};
    const q = c.quotes && c.quotes[0];
    const head = total > 1 ? `Claim ${n} of ${total}` : "Adjudicated claim";
    return `
      ${c.text ? `<div class="g-sec"><h4>${head} ${c.verdict ? `<span class="chip">${esc(c.verdict)}</span>` : ""}</h4>
        <div>${esc(c.text)}</div>${evidenceLine(c)}</div>` : ""}
      ${q ? `<div class="g-sec"><h4>Paper quote</h4><blockquote class="quote">"${esc(q.quote)}"${q.page != null ? ` <span class="muted">p.${q.page}</span>` : ""}</blockquote></div>` : ""}
      <div class="g-sec g-links">
        ${c.id ? `<a class="btn" href="#/claims?claim=${encodeURIComponent(c.id)}">Jump to this claim →</a>` : ""}
        ${c.paper ? `<a href="#/claims?paper=${encodeURIComponent(c.paper)}">All claims in ${esc(c.paper)}</a>` : ""}
      </div>`;
  }

  function edgePanel(e) {
    if (!e) return panelHint();
    const ids = e.claim_ids || [e.claim_id];
    return `
      <div class="g-panel-head"><strong>${esc(labelOf(e.subject))}</strong> <span class="chip">${esc(e.relation)}</span> <strong>${esc(labelOf(e.object))}</strong>
        <span class="muted mono" style="font-size:11px">${esc(e.layer)}</span></div>
      ${ids.map((cid, i) => claimBlock(cid, i + 1, ids.length)).join('<hr class="g-rule">')}`;
  }

  function originLine(n) {
    // Ungrounded nodes (no origin block from build_dashboard) render nothing —
    // never a fabricated "introduced by".
    if (!n.origin) return "";
    const label = esc(n.origin.display || n.origin.key || "source");
    const link = n.origin.url
      ? `<a href="${esc(n.origin.url)}" target="_blank" rel="noopener">${label}</a>`
      : label;
    return `<div class="g-sec g-origin">Introduced by ${link} <span class="chip">${esc(n.origin.source)}</span></div>`;
  }

  function nodePanel(id, s) {
    const n = nodeById.get(id) || { id, type: "untyped", degree: 0 };
    const incident = s.edges.filter((e) => e.subject === id || e.object === id);
    // Read from the focused node outward: "uses → X" (it is the subject) or
    // "X outperforms →" (it is the object). Merged edges show their claim count.
    // Edges whose first claim carries a number sort first — a materials
    // scientist scanning relations sees the value without opening the claim.
    // The number that speaks for the edge, not the claim's first number: a
    // claim states several unrelated quantities, and numbers[0] labelled
    // "hosts → hybridised exciton states" with a PL redshift.
    const evidenceNumber = (e) => {
      const nums = (claimById.get(e.claim_id) || {}).numbers;
      return pickEvidenceNumber(nums, e.subject, e.object);
    };
    const rels = incident
      .slice()
      .sort((a, b) => (evidenceNumber(a) ? 0 : 1) - (evidenceNumber(b) ? 0 : 1))
      .map((e) => {
        const i = s.edges.indexOf(e);
        const rel = `<span class="mono">${esc(e.relation)}</span>`;
        const dir = e.subject === id
          ? `${rel} → <strong>${esc(labelOf(e.object))}</strong>`
          : `<strong>${esc(labelOf(e.subject))}</strong> ${rel} →`;
        const n = e.weight > 1 ? ` <span class="g-rel-n">×${e.weight}</span>` : "";
        const num = evidenceNumber(e);
        const val = num
          ? `<span class="g-val"> · ${esc(clip(num.quantity))} = ${esc(num.value)}</span>`
          : "";
        const quals = qualText(e);
        const qual = quals ? `<span class="g-val"> · ${esc(quals)}</span>` : "";
        return `<li><button class="g-rel-btn" data-i="${i}">${dir}${n}${val}${qual}</button></li>`;
      }).join("");
    return `
      <div class="g-panel-head"><span class="dot" style="background:${typeColor(n.type)};width:11px;height:11px;border-radius:50%"></span>
        <strong>${esc(labelOf(n.id))}</strong> <span class="chip">${esc(n.type)}</span>
        <span class="muted" style="font-size:12px">degree ${fmt(n.degree)}</span></div>
      ${originLine(n)}
      <div class="g-sec"><h4>Relations (${incident.length})</h4><ul class="g-rels">${rels || '<li class="muted">none under filters</li>'}</ul></div>
      <a href="#/claims?q=${encodeURIComponent(n.id)}">Search claims for ${esc(n.id)} →</a>`;
  }

  const panelHint = () =>
    `<div class="empty">Click a node to focus its neighbourhood, or an edge to see the claim behind it.</div>`;

  function draw() {
    const s = sub();
    const focused = state.focus && nodeById.has(state.focus);
    const count = root.querySelector("#g-count");
    const cut = activeCut();
    if (focused) {
      count.innerHTML = `focused on <strong>${esc(state.focus)}</strong> · ${fmt(Math.max(0, s.nodes.length - 1))} neighbours${s.truncated ? " (top by degree)" : ""} · <a href="#" id="g-clear">back to overview</a>`;
    } else {
      const scope = cut > 1
        ? `${fmt(s.nodes.length)} of ${fmt(graph.nodes.length)} nodes · ${fmt(s.edges.length)} edges · degree ≥ ${cut} · <a href="#" id="g-all">show all</a>`
        : `${fmt(s.nodes.length)} nodes · ${fmt(s.edges.length)} edges`;
      count.innerHTML = `${scope} · click a node to focus`;
    }
    const availW = Math.max(820, (canvas.clientWidth || 1000) - 12);
    canvas.innerHTML = s.nodes.length ? renderSVG(s, availW) : `<div class="empty">No relations match these filters.</div>`;
    panel.innerHTML = focused ? nodePanel(state.focus, s) : panelHint();
    if (s.nodes.length) wire(s);
    const clr = root.querySelector("#g-clear");
    if (clr) clr.addEventListener("click", (ev) => { ev.preventDefault(); state.focus = ""; syncHash(); draw(); });
    const all = root.querySelector("#g-all");
    if (all) all.addEventListener("click", (ev) => { ev.preventDefault(); setDeg(1); });
  }

  function setDeg(k) {
    state.deg = k;
    root.querySelector("#gf-deg").value = String(k);
    syncHash();
    draw();
  }

  function wire(s) {
    const svg = canvas.querySelector(".graph-svg");
    // Precompute adjacency once per draw so a hover is O(degree), not a scan of
    // every edge for every node (O(nodes x edges) — ~1M ops per mouse-move on
    // an 800-node graph).
    const adj = new Map();
    for (const e of s.edges) {
      if (!adj.has(e.subject)) adj.set(e.subject, new Set());
      if (!adj.has(e.object)) adj.set(e.object, new Set());
      adj.get(e.subject).add(e.object);
      adj.get(e.object).add(e.subject);
    }
    for (const g of svg.querySelectorAll(".g-node")) {
      const id = g.getAttribute("data-id");
      g.addEventListener("mouseenter", () => highlight(svg, adj, id));
      g.addEventListener("mouseleave", () => clearHi(svg));
      g.addEventListener("click", () => { state.focus = id; syncHash(); draw(); });
      g.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); state.focus = id; syncHash(); draw(); }
      });
    }
    for (const ln of svg.querySelectorAll(".g-edge")) {
      ln.addEventListener("click", () => { panel.innerHTML = edgePanel(s.edges[+ln.getAttribute("data-i")]); });
    }
    panel.onclick = (ev) => {
      const btn = ev.target.closest(".g-rel-btn");
      if (btn) panel.innerHTML = edgePanel(s.edges[+btn.getAttribute("data-i")]);
    };
  }

  function highlight(svg, adj, id) {
    svg.classList.add("has-hover");
    for (const ln of svg.querySelectorAll(".g-edge"))
      ln.classList.toggle("hot", ln.getAttribute("data-s") === id || ln.getAttribute("data-o") === id);
    const nbrs = adj.get(id);
    for (const g of svg.querySelectorAll(".g-node")) {
      const nid = g.getAttribute("data-id");
      g.classList.toggle("hot", nid === id || (nbrs ? nbrs.has(nid) : false));
    }
  }
  // Legend hover: every edge of one relation, plus the nodes those edges touch.
  function highlightRel(svg, rel) {
    svg.classList.add("has-hover");
    const ends = new Set();
    for (const ln of svg.querySelectorAll(".g-edge")) {
      const hit = ln.getAttribute("data-rel") === rel;
      ln.classList.toggle("hot", hit);
      if (hit) { ends.add(ln.getAttribute("data-s")); ends.add(ln.getAttribute("data-o")); }
    }
    for (const g of svg.querySelectorAll(".g-node")) g.classList.toggle("hot", ends.has(g.getAttribute("data-id")));
  }
  const clearHi = (svg) => {
    svg.classList.remove("has-hover");
    for (const el of svg.querySelectorAll(".hot")) el.classList.remove("hot");
  };

  function syncHash() {
    const p = new URLSearchParams();
    for (const k of ["focus", "type", "rel", "layer", "q"]) if (state[k]) p.set(k, state[k]);
    if (state.deg !== autoDeg) p.set("deg", String(state.deg)); // the auto cut is the default, so only a chosen one is a link
    const q = p.toString();
    history.replaceState(null, "", `#/graph${q ? "?" + q : ""}`);
  }

  root.querySelector("#gf-deg").addEventListener("change", (e) => setDeg(parseInt(e.target.value, 10) || 1));
  root.querySelector("#gf-type").addEventListener("change", (e) => { state.type = e.target.value; syncHash(); draw(); });
  root.querySelector("#gf-rel").addEventListener("change", (e) => { state.rel = e.target.value; syncHash(); draw(); });
  root.querySelector("#gf-layer").addEventListener("change", (e) => { state.layer = e.target.value; syncHash(); draw(); });
  root.querySelector("#gf-q").addEventListener("input", (e) => { state.q = e.target.value; syncHash(); draw(); });
  root.querySelector("#gf-reset").addEventListener("click", () => {
    Object.assign(state, { focus: "", type: "", rel: "", layer: "", q: "", deg: autoDeg });
    for (const el of root.querySelectorAll(".toolbar select")) el.value = "";
    root.querySelector("#gf-deg").value = String(autoDeg);
    root.querySelector("#gf-q").value = "";
    syncHash();
    draw();
  });

  draw();
}

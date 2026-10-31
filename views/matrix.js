import { load, fmt } from "../data.js";
import { buildMatrix, cellWeight, UNASSIGNED_ROW } from "./matrix-model.js";

// Systems × properties. The graph answers "what is related to what"; this
// answers the question a materials scientist actually asks of a corpus —
// which system hosts which property, on what evidence, and WHERE THE GAPS
// ARE. An empty cell is drawn, not omitted: the unexplored combinations are
// the point of the view.
//
// Rows, columns and cells come from matrix-model.js; this module renders and
// wires. Which node type makes a column and which relation counts as stated
// are domain data ([systems.matrix] in domain.toml, carried by the bundle).

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const heatColor = (frac) => {
  // low -> panel-ish, high -> accent. HSL ramp. (Same ramp as the Lenses view.)
  const l = 62 - frac * 34;
  return `hsl(${222 - frac * 60}, 70%, ${l}%)`;
};

const TOP_COLS = 40; // columns shown before "show all"
const HEAD_MAX = 26; // chars of a column label in its rotated header
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

// A row's summary: its family, then the attributes the domain declared that
// read as prose. Shape only — no attribute NAME is known to this code.
// Numeric attributes are skipped: the systems spec makes them the
// machine-readable companions of a prose one (`twist_angle_deg` beside
// `twist_angle`), so a bare number here would be a value with no key.
function summarize(row) {
  const attrs = row.attributes || {};
  const all = [
    ...new Set([row.family, ...Object.values(attrs).filter((v) => typeof v === "string")]),
  ].filter(Boolean);
  // Drop a part another part already contains ("twisted TMD homobilayer"
  // inside "twisted TMD homobilayer (AA-stacked)") so the two lines the label
  // column allows are spent on new information — the twist angle, the
  // substrate — rather than on a family name said twice.
  return all
    .filter((p, i) => !all.some((q, j) => j !== i && q.length > p.length && q.includes(p)))
    .join(" · ");
}

export async function render(root, params = {}) {
  let systems;
  try {
    systems = await load("systems");
  } catch {
    root.innerHTML = `<div class="empty">This domain declares no systems; see docs/methodology.md § systems layer</div>`;
    return;
  }
  const config = { ...systems.config, ...(systems.config || {}).matrix };
  if (!config.property_type || !config.relation) {
    root.innerHTML = `<div class="empty">This domain's systems layer declares no <span class="mono">[systems.matrix]</span> table; see docs/methodology.md § systems layer</div>`;
    return;
  }
  const graph = await load("graph");
  const claims = await load("claims");
  const claimById = new Map(claims.map((c) => [c.id, c]));

  const m = buildMatrix({
    systems: systems.systems,
    nodes: graph.nodes,
    edges: graph.edges,
    claims,
    config,
  });
  const rowById = new Map(m.rows.map((r) => [r.id, r]));
  const colById = new Map(m.cols.map((c) => [c.id, c]));
  const maxWeight = m.cols.length
    ? Math.max(...m.rows.map((r) => Math.max(0, ...m.cols.map((c) => cellWeight(m.cells[r.id][c.id])))))
    : 0;

  const state = {
    cell: params.cell && params.cell.includes("|") ? params.cell : "",
    all: params.all === "1",
    q: "",
  };
  if (state.cell) {
    const [r, c] = state.cell.split("|");
    if (!rowById.has(r) || !colById.has(c)) state.cell = "";
    // A deep link can name a column outside the default top-40 slice. Opening
    // the panel for a cell the reader cannot see would be a dead end, so the
    // link turns the cap off for itself.
    else if (m.cols.findIndex((x) => x.id === c) >= TOP_COLS) state.all = true;
  }

  const shownCols = () => {
    const q = state.q.trim().toLowerCase();
    const hits = q ? m.cols.filter((c) => c.id.toLowerCase().includes(q)) : m.cols;
    return state.all ? hits : hits.slice(0, TOP_COLS);
  };

  root.innerHTML = `
    <div style="padding:16px 24px 0">
      <div class="toolbar">
        <input type="search" id="mx-q" placeholder="Filter ${esc(config.property_type.replace(/_/g, " "))} columns…" value=""/>
        <button class="btn" id="mx-all"></button>
        <span class="muted mono" id="mx-count"></span>
      </div>
      <div class="legend">
        <span class="legend-label">Cells</span>
        <span class="chip"><span class="matrix-swatch matrix-swatch-empty"></span>no evidence in this corpus</span>
        <span class="chip"><span class="matrix-swatch" style="background:${heatColor(0.2)}"></span><span class="matrix-swatch" style="background:${heatColor(0.55)}"></span><span class="matrix-swatch" style="background:${heatColor(0.9)}"></span>more evidence</span>
        <span class="chip"><strong>n</strong> stated <span class="mono">${esc(config.relation)}</span> edges · <strong>+n</strong> other claims of the system that mention it</span>
      </div>
    </div>
    <div class="matrix-wrap">
      <div class="matrix-scroll" id="mx-canvas"></div>
      <aside class="inspector" id="mx-panel"></aside>
    </div>`;

  const canvas = root.querySelector("#mx-canvas");
  const panel = root.querySelector("#mx-panel");
  const countEl = root.querySelector("#mx-count");
  const allBtn = root.querySelector("#mx-all");

  function rowHead(row) {
    // The unassigned row is a remainder, not a system: it names no one node,
    // so it gets no link into the graph and says how many nodes it stands for.
    if (row.id === UNASSIGNED_ROW)
      return `<th class="matrix-row-head" scope="row">
        <div class="matrix-row-name"><em>${esc(row.label)}</em></div>
        <div class="matrix-row-sub muted">${fmt(row.node_ids.length)} nodes no declared system matched</div>
      </th>`;
    const summary = summarize(row);
    const first = row.node_ids[0];
    const name = esc(row.label);
    const link = first
      ? `<a href="#/graph?focus=${encodeURIComponent(first)}" title="Open this system in the graph">${name}</a>`
      : `<span title="No node of a declared system type matched">${name}</span>`;
    // The paper count sits on the name line, where no clamp can eat it: an
    // empty row backed by 8 papers is a gap in what the corpus SAYS, and an
    // empty row backed by 1 is mostly a gap in what it covers.
    return `<th class="matrix-row-head" scope="row">
      <div class="matrix-row-name">${link}
        <span class="matrix-row-papers">${fmt(row.papers)} paper${row.papers === 1 ? "" : "s"}</span></div>
      <div class="matrix-row-sub muted" title="${esc(summary)}">${esc(summary)}</div>
    </th>`;
  }

  function cellHtml(row, col) {
    const cell = m.cells[row.id][col.id];
    const w = cellWeight(cell);
    const key = `${row.id}|${col.id}`;
    const on = state.cell === key ? " active" : "";
    if (!w) {
      return `<td><button class="matrix-cell matrix-empty${on}" data-cell="${esc(key)}" title="${esc(row.label)} × ${esc(col.label)} — nothing in this corpus" aria-label="no evidence"></button></td>`;
    }
    // Square-root normalisation. Weight is very long-tailed — one cell at 21
    // against a mode of 1 — so a linear ramp puts almost every cell in the
    // bottom eighth and the grid reads as flat. sqrt spreads the low end,
    // which is where the reading happens.
    const bg = heatColor(maxWeight ? Math.sqrt(w) / Math.sqrt(maxWeight) : 0);
    // A stated edge is the headline number; mentions are the smaller "+n"
    // underneath. A cell with mentions only shows the "+n" alone — never a
    // bare 0, which reads as "measured zero" rather than "not stated".
    const mention = cell.mentioned.length
      ? `<span class="matrix-m">+${fmt(cell.mentioned.length)}</span>`
      : "";
    const stated = cell.stated.length
      ? `<span class="matrix-s">${fmt(cell.stated.length)}</span>`
      : "";
    const title = `${row.label} × ${col.label} — ${cell.stated.length} stated, ${cell.mentioned.length} mentioned`;
    return `<td><button class="matrix-cell${stated ? "" : " matrix-weak"}${on}" data-cell="${esc(key)}" style="background:${bg}" title="${esc(title)}">
      ${stated}${mention}</button></td>`;
  }

  function draw() {
    const cols = shownCols();
    const head = cols
      .map((c) => `<th class="matrix-col-head" scope="col" title="${esc(c.label)}"><span>${esc(clip(c.label, HEAD_MAX))}</span></th>`)
      .join("");
    const body = m.rows
      .map((r) => `<tr>${rowHead(r)}${cols.map((c) => cellHtml(r, c)).join("")}</tr>`)
      .join("");
    canvas.innerHTML = cols.length
      ? `<table class="matrix"><thead><tr><th class="matrix-corner">${esc(config.property_type.replace(/_/g, " "))} →</th>${head}</tr></thead><tbody>${body}</tbody></table>`
      : `<div class="empty">No ${esc(config.property_type.replace(/_/g, " "))} matches this filter.</div>`;
    // The unassigned row is a remainder, not a system, so it is named apart
    // from the count rather than folded into it.
    const declared = m.rows.filter((r) => r.id !== UNASSIGNED_ROW).length;
    const rest = declared < m.rows.length ? " + unassigned" : "";
    countEl.textContent = `${fmt(declared)} systems${rest} × ${fmt(cols.length)} of ${fmt(m.cols.length)} columns`;
    allBtn.textContent = state.all ? `Top ${TOP_COLS} columns` : "Show all columns";
    for (const b of canvas.querySelectorAll(".matrix-cell"))
      b.addEventListener("click", () => open(b.getAttribute("data-cell")));
    panel.innerHTML = state.cell ? cellPanel(state.cell) : panelHint();
  }

  function open(key) {
    state.cell = state.cell === key ? "" : key;
    syncHash();
    for (const b of canvas.querySelectorAll(".matrix-cell"))
      b.classList.toggle("active", b.getAttribute("data-cell") === state.cell);
    panel.innerHTML = state.cell ? cellPanel(state.cell) : panelHint();
  }

  const panelHint = () =>
    `<div class="empty">Click a cell to read the claims behind it. An outlined cell is a combination this corpus never states.</div>`;

  // The claims behind one cell, strongest evidence first: stated before
  // mentioned, and a findings claim before a context one inside each group.
  // `section` is pipeline vocabulary — every domain's claims are findings or
  // context — so ordering on it names no domain's content.
  function claimRows(cell) {
    const kind = new Map();
    for (const e of cell.stated) if (e.claim_id && !kind.has(e.claim_id)) kind.set(e.claim_id, "stated");
    for (const e of cell.mentioned) if (e.claim_id && !kind.has(e.claim_id)) kind.set(e.claim_id, "mentioned");
    return [...kind]
      .map(([id, k]) => ({
        id,
        kind: k,
        rank: (k === "stated" ? 0 : 2) + ((claimById.get(id) || {}).section === "findings" ? 0 : 1),
      }))
      .sort((a, b) => a.rank - b.rank);
  }

  function claimBlock({ id: cid, kind }) {
    const c = claimById.get(cid);
    if (!c) return "";
    const e = c.experiment || {};
    const cond = [e.system, e.perturbation, e.measurement].filter(Boolean).join(" · ");
    // `numbers` arrives with piece B; feature-detect so this view works either
    // way. filter(Boolean) after the template was a no-op — every template
    // string is truthy — so a number with no label rendered "null = null".
    // Drop the empty parts first, and a half-stated number reads as the half
    // it has.
    const nums = (Array.isArray(c.numbers) ? c.numbers : [])
      .map((n) => [n && n.quantity, n && n.value].filter(Boolean).join(" = "))
      .filter(Boolean);
    return `
      <div class="g-sec">
        <div class="matrix-kind">
          <span class="chip ${kind === "stated" ? "matrix-stated" : ""}">${kind === "stated" ? `stated ${esc(config.relation)}` : "mentioned"}</span>
          ${c.section ? `<span class="muted">${esc(c.section)}</span>` : ""}
        </div>
        <div>${esc(c.text)}</div>
        ${cond ? `<div class="matrix-cond muted">${esc(cond)}</div>` : ""}
        ${nums.length ? `<div class="matrix-nums mono">${esc(nums.join(" · "))}</div>` : ""}
        <div class="g-links"><a href="#/claims?claim=${encodeURIComponent(c.id)}">${esc(c.id)} →</a></div>
      </div>`;
  }

  function cellPanel(key) {
    const [rid, cid] = key.split("|");
    const row = rowById.get(rid), col = colById.get(cid);
    const cell = m.cells[rid][cid];
    const ids = claimRows(cell);
    const summary = summarize(row);
    const head = `
      <div class="g-panel-head"><strong>${esc(row.label)}</strong>
        <span class="muted">×</span> <strong>${esc(col.label)}</strong></div>
      ${summary ? `<div class="matrix-cond muted">${esc(summary)}</div>` : ""}
      <div class="g-sec muted">${fmt(cell.stated.length)} stated <span class="mono">${esc(config.relation)}</span> ·
        ${fmt(cell.mentioned.length)} mentioned in this system's claims</div>`;
    if (!ids.length)
      return `${head}<div class="g-sec">No claim in this corpus links them. That gap is the finding.</div>
        <div class="g-links"><a href="#/claims?q=${encodeURIComponent(col.id)}">Search claims for ${esc(col.label)} →</a></div>`;
    return head + ids.map(claimBlock).join('<hr class="g-rule">');
  }

  function syncHash() {
    const p = new URLSearchParams();
    if (state.cell) p.set("cell", state.cell);
    if (state.all) p.set("all", "1");
    const q = p.toString();
    history.replaceState(null, "", `#/matrix${q ? "?" + q : ""}`);
  }

  allBtn.addEventListener("click", () => {
    state.all = !state.all;
    syncHash();
    draw();
  });
  root.querySelector("#mx-q").addEventListener("input", (ev) => {
    state.q = ev.target.value;
    draw();
  });

  draw();
}

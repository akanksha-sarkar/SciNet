// Plots: the corpus's typed numbers, drawn. Every point is one number on one
// adjudicated claim, so a point is always traceable back to a sentence in a
// paper — clicking it opens that claim. Rendering and wiring only; the
// pairing and the axis arithmetic live in plots-model.js, which is tested.
import { load, makeTypeColor } from "../data.js";
import { pointsFor, niceTicks, tickLabel, logYSplit, logTicks, logTickLabel } from "./plots-model.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const W = 720, H = 420, M = 40;

// A bounded value is not a point: the paper said "exceed 10 K", so the mark
// opens in the direction the true value lies.
const triangle = (x, y, bound) => {
  const r = 6;
  return bound === "lower"
    ? `${x},${y - r} ${x - r},${y + r * 0.7} ${x + r},${y + r * 0.7}`
    : `${x},${y + r} ${x - r},${y - r * 0.7} ${x + r},${y - r * 0.7}`;
};

// A value as a reader would write it: 0.426 stays, 1e-7 does not.
const num = (v) => (Math.abs(v) >= 0.001 || v === 0 ? String(Number(v.toPrecision(4))) : v.toExponential(1));
const withUnit = (v, unit) => `${num(v)}${unit ? ` ${unit}` : ""}`;

// Where a point's x came from, in the reader's words — long for a tooltip or
// the side panel, short for a table cell that must not wrap five lines deep.
const X_SOURCE = {
  claim: "this claim",
  claim_system: "this claim's system string",
  system: "the system's attribute",
};
const X_SOURCE_SHORT = {
  claim: "claim",
  claim_system: "system string",
  system: "system",
};

export async function render(root, params = {}) {
  let data;
  try {
    data = await load("quantities");
  } catch {
    root.innerHTML = `<div class="empty">This domain declares no quantity kinds, so there is nothing to plot.</div>`;
    return;
  }
  const claims = await load("claims").catch(() => []);
  const claimById = new Map(claims.map((c) => [c.id, c]));
  const kinds = new Map((data.kinds || []).map((k) => [k.kind, k]));
  const systems = data.systems || {};
  const rows = data.rows || [];
  const plots = (data.plots || []).map((p) => ({
    plot: p,
    ...pointsFor(p, rows, systems, data.claims || {}, data.kinds || []),
  }));

  const families = [...new Set(plots.flatMap(({ points }) => points.map((p) => p.family)).filter(Boolean))].sort();
  const famColor = makeTypeColor(families);
  const axisLabel = (kind) => {
    const k = kinds.get(kind);
    const name = k ? k.label : kind;
    return k && k.unit ? `${name} (${k.unit})` : name;
  };
  const unitOf = (kind) => (kinds.get(kind) || {}).unit || "";
  // A system the rows name but systems.jsonl does not carry is a build skew,
  // not a crash: fall back to the id, then to a dash.
  const systemLabel = (id) => (id ? (systems[id] || {}).label || id : "");

  // "parsed" is the honest count for this sentence: a row the parser could not
  // read ("five devices") is on the page's rows but is on no axis, so counting
  // every measured row tells a reader the plots hold seven numbers they cannot
  // find.
  const measured = rows.filter((r) => r.source !== "system");
  const parsed = measured.filter((r) => r.value !== null && r.value !== undefined);
  const kinded = parsed.filter((r) => r.kind).length;
  const derived = rows.filter((r) => r.source === "system").length;
  // Linear by default; the checkbox redraws every plot on a log y axis.
  let logY = false;
  root.innerHTML = `
    <div class="plots-wrap">
      <div class="plots-scroll">
        <h1>Plots</h1>
        <p class="lead">Every point is one number on one adjudicated claim.
          ${parsed.length} numbers were parsed out of the corpus, ${kinded}
          of them carry a kind, and ${derived} more values were read out of the
          claims' own system strings. How a point is drawn says where its
          horizontal position came from, and a plot's subtitle says what it left
          out. Click any point to read the claim behind it.</p>
        <label class="op-toggle"><input type="checkbox" id="pl-logy" /> log y axis
          (a y at or below zero is not drawn, and the subtitle counts it)</label>
        <div class="legend" id="pl-legend"></div>
        <div id="pl-sections">${plots.map(sectionFor).join("")}</div>
      </div>
      <aside class="inspector" id="pl-panel">
        <div class="muted">Select a point to see the claim it comes from.</div>
      </aside>
    </div>`;

  root.querySelector("#pl-legend").innerHTML =
    `<span class="legend-label">Family</span>` +
    (families.length
      ? families
          .map((f) => `<span class="chip"><span class="dot" style="background:${famColor(f)}"></span>${esc(f)}</span>`)
          .join("")
      : `<span class="muted">no points yet</span>`) +
    `<span class="legend-label" style="margin-left:14px">x from</span>` +
    `<span class="chip"><span class="dot pl-key-claim"></span>the claim's own number</span>` +
    `<span class="chip"><span class="dot pl-key-system-string"></span>the claim's system string</span>` +
    `<span class="chip"><span class="dot pl-key-system"></span>the system's attribute</span>` +
    `<span class="legend-label" style="margin-left:14px">y</span>` +
    `<span class="chip"><span class="pl-key-tri up"></span>a stated lower bound</span>` +
    `<span class="chip"><span class="pl-key-tri down"></span>a stated upper bound</span>`;

  function sectionFor({ plot, points, excluded, unit_mismatch }) {
    const head = `<h2>${esc(plot.title)}</h2>`;
    const left = [
      excluded ? `${excluded} excluded (context/theory)` : "",
      unit_mismatch ? `${unit_mismatch} unit-mismatch` : "",
    ].filter(Boolean);
    if (points.length < 2) {
      return `<section class="card pl-card">${head}
        <div class="empty">${points.length} point${points.length === 1 ? "" : "s"}, not enough to plot.
        <br><span class="muted">Needs a ${esc(axisLabel(plot.y))} and a ${esc(axisLabel(plot.x))}
        on the same claim${plot.x_system_attribute ? ", or a system that declares one" : ""}${
          left.length ? `; ${esc(left.join(" · "))}` : ""
        }.</span></div>
      </section>`;
    }
    const papers = new Set(points.map((p) => p.claim_id.split(":")[0])).size;
    // On a log axis only a positive y has a place; the rest stay in the
    // table and are counted here, never clamped to the axis floor.
    const { keep, skipped } = logY ? logYSplit(points) : { keep: points.map((_, i) => i), skipped: 0 };
    const logNote = skipped ? [`${skipped} with y ≤ 0 not drawn (log axis)`] : [];
    const sub = [`${points.length} points`, `${papers} papers`, ...left, ...logNote].join(" · ");
    const chart =
      keep.length < 2
        ? `<div class="empty">${keep.length} point${keep.length === 1 ? "" : "s"} with y > 0, not enough for a log axis.</div>`
        : svg(plot, points, keep);
    return `<section class="card pl-card">${head}
      <div class="muted pl-sub">${esc(sub)}</div>
      ${chart}
      ${table(plot, points)}
    </section>`;
  }

  // `keep` is the indices of the points to draw (all of them on a linear
  // axis); a mark's data-i stays its index in `points`, like its table row.
  function svg(plot, points, keep) {
    const drawn = keep.map((i) => points[i]);
    const xs = drawn.map((p) => p.x), ys = drawn.map((p) => p.y);
    const xt = niceTicks(Math.min(...xs), Math.max(...xs), 5);
    const yt = logY ? logTicks(Math.min(...ys), Math.max(...ys)) : niceTicks(Math.min(...ys), Math.max(...ys), 5);
    const xStep = xt.length > 1 ? xt[1] - xt[0] : 1;
    const yStep = yt.length > 1 ? yt[1] - yt[0] : 1;
    const yLabel = (t) => (logY ? logTickLabel(t) : tickLabel(t, yStep));
    const yScale = logY ? Math.log10 : (v) => v;
    const x0 = xt[0], x1 = xt[xt.length - 1];
    const y0 = yScale(yt[0]), y1 = yScale(yt[yt.length - 1]);
    const px = (v) => M + ((v - x0) / (x1 - x0 || 1)) * (W - 2 * M);
    const py = (v) => H - M - ((yScale(v) - y0) / (y1 - y0 || 1)) * (H - 2 * M);

    const grid = [
      ...xt.map((t) => `<line class="pl-grid" x1="${px(t)}" y1="${M}" x2="${px(t)}" y2="${H - M}"></line>
        <text class="pl-tick" x="${px(t)}" y="${H - M + 16}" text-anchor="middle">${esc(tickLabel(t, xStep))}</text>`),
      ...yt.map((t) => `<line class="pl-grid" x1="${M}" y1="${py(t)}" x2="${W - M}" y2="${py(t)}"></line>
        <text class="pl-tick" x="${M - 6}" y="${py(t)}" dy="0.35em" text-anchor="end">${esc(yLabel(t))}</text>`),
    ].join("");
    const axes = `
      <line class="pl-axis" x1="${M}" y1="${M}" x2="${M}" y2="${H - M}"></line>
      <line class="pl-axis" x1="${M}" y1="${H - M}" x2="${W - M}" y2="${H - M}"></line>
      <text class="pl-axis-label" x="${W / 2}" y="${H - 6}" text-anchor="middle">${esc(axisLabel(plot.x))}</text>
      <text class="pl-axis-label" x="${-H / 2}" y="12" transform="rotate(-90)" text-anchor="middle">${esc(axisLabel(plot.y))}${logY ? " (log)" : ""}</text>`;
    const marks = keep
      .map((i) => {
        const p = points[i];
        const color = famColor(p.family);
        // The shape says how the x was obtained, so a reader never has to
        // take the curator's number for the paper's: filled = the claim's own
        // number, ring = read out of the claim's system string, thin hollow =
        // the system's declared attribute.
        const fill = p.x_from === "claim" ? color : "none";
        const width = { claim: 1.5, claim_system: 3.5, system: 1.2 }[p.x_from];
        const r = p.x_from === "system" ? 4 : 5;
        const from = `x from ${X_SOURCE[p.x_from]}`;
        const bound = p.bound ? ` (a stated ${p.bound} bound)` : "";
        const title = `${systemLabel(p.system_id) || "unassigned"} · ${withUnit(p.x, unitOf(plot.x))}, ${withUnit(p.y, unitOf(plot.y))}${bound} · ${from} · ${p.claim_id}`;
        const shape = p.bound
          ? `<polygon points="${triangle(px(p.x), py(p.y), p.bound)}"`
          : `<circle cx="${px(p.x)}" cy="${py(p.y)}" r="${r}"`;
        return `${shape} class="pl-dot" data-i="${i}" tabindex="0" role="button"
          fill="${fill}" stroke="${color}" stroke-width="${width}"><title>${esc(title)}</title></${p.bound ? "polygon" : "circle"}>`;
      })
      .join("");
    return `<svg class="pl-svg" data-plot="${esc(plot.id)}" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"
      role="img" aria-label="${esc(plot.title)}">${grid}${axes}${marks}</svg>`;
  }

  function table(plot, points) {
    const body = points
      .map(
        (p, i) => `<tr data-plot="${esc(plot.id)}" data-i="${i}">
        <td>${esc(systemLabel(p.system_id) || "—")}</td>
        <td class="mono">${esc(withUnit(p.x, unitOf(plot.x)))} <span class="muted">(${esc(X_SOURCE_SHORT[p.x_from])})</span></td>
        <td class="mono">${p.bound ? esc(p.bound === "lower" ? "> " : "< ") : ""}${esc(withUnit(p.y, unitOf(plot.y)))}</td>
        <td class="muted">${esc(p.row.quantity)} = ${esc(p.row.raw)}</td>
        <td><a href="#/claims?claim=${encodeURIComponent(p.claim_id)}">${esc(p.claim_id)}</a></td>
      </tr>`,
      )
      .join("");
    return `<div class="pl-table"><table>
      <thead><tr><th>system</th><th>${esc(axisLabel(plot.x))}</th><th>${esc(axisLabel(plot.y))}</th><th>as the paper writes it</th><th>claim</th></tr></thead>
      <tbody>${body}</tbody></table></div>`;
  }

  // ---- selection
  const panel = root.querySelector("#pl-panel");
  const byId = new Map(plots.map(({ plot, points }) => [plot.id, { plot, points }]));

  function select(plotId, index) {
    const entry = byId.get(plotId);
    const p = entry && entry.points[index];
    if (!p) return;
    selected = [plotId, index];
    const claim = claimById.get(p.claim_id) || {};
    const numbers = rows.filter((r) => r.claim_id === p.claim_id);
    const q = claim.quotes && claim.quotes[0];
    panel.innerHTML = `
      <div class="g-panel-head"><strong>${esc(systemLabel(p.system_id) || "unassigned system")}</strong>
        ${p.family ? `<span class="chip"><span class="dot" style="background:${famColor(p.family)}"></span>${esc(p.family)}</span>` : ""}</div>
      <div class="g-sec"><h4>${esc(entry.plot.title)}</h4>
        <div class="mono">${esc(axisLabel(entry.plot.x))} = ${esc(withUnit(p.x, unitOf(entry.plot.x)))}</div>
        <div class="muted">x read from ${esc(X_SOURCE[p.x_from])}${p.x_row ? `: "${esc(p.x_row.raw)}"` : ""}</div>
        <div class="mono">${esc(axisLabel(entry.plot.y))} = ${p.bound ? esc(p.bound === "lower" ? "> " : "< ") : ""}${esc(withUnit(p.y, unitOf(entry.plot.y)))}</div>
        ${p.bound ? `<div class="muted">the paper states a ${esc(p.bound)} bound, not a value</div>` : ""}
      </div>
      ${claim.text ? `<div class="g-sec"><h4>Adjudicated claim</h4><div>${esc(claim.text)}</div></div>` : ""}
      ${q ? `<div class="g-sec"><h4>Paper quote</h4><blockquote class="quote">"${esc(q.quote)}"${q.page != null ? ` <span class="muted">p.${q.page}</span>` : ""}</blockquote></div>` : ""}
      <div class="g-sec"><h4>Numbers on this claim</h4>
        <ul class="pl-nums">${numbers
          .map((r) => `<li><span class="mono">${esc(r.raw)}</span> — ${esc(r.quantity)}${r.kind ? ` <span class="chip">${esc((kinds.get(r.kind) || {}).label || r.kind)}</span>` : ""}</li>`)
          .join("")}</ul></div>
      <div class="g-sec g-links">
        <a class="btn" href="#/claims?claim=${encodeURIComponent(p.claim_id)}">Jump to this claim →</a>
        <a href="#/claims?paper=${encodeURIComponent(p.claim_id.split(":")[0])}">All claims in ${esc(p.claim_id.split(":")[0])}</a>
      </div>`;
    for (const el of root.querySelectorAll(".pl-dot.hot")) el.classList.remove("hot");
    const dot = root.querySelector(`.pl-svg[data-plot="${CSS.escape(plotId)}"] .pl-dot[data-i="${index}"]`);
    if (dot) dot.classList.add("hot");
  }

  // Bound to the wrapper this render created, not to `root`: the router
  // replaces the wrapper on every navigation, so the listeners go with it
  // instead of stacking up one set per visit.
  const wrap = root.querySelector(".plots-wrap");
  wrap.addEventListener("click", (e) => {
    const dot = e.target.closest(".pl-dot");
    if (dot) return select(dot.closest(".pl-svg").dataset.plot, +dot.dataset.i);
    const tr = e.target.closest("tr[data-plot]");
    if (tr && !e.target.closest("a")) select(tr.dataset.plot, +tr.dataset.i);
  });
  wrap.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const dot = e.target.closest && e.target.closest(".pl-dot");
    if (dot) {
      e.preventDefault();
      select(dot.closest(".pl-svg").dataset.plot, +dot.dataset.i);
    }
  });

  // The selected point's panel stays; its mark is redrawn, so re-mark it.
  let selected = null;
  root.querySelector("#pl-logy").addEventListener("change", (e) => {
    logY = e.target.checked;
    root.querySelector("#pl-sections").innerHTML = plots.map(sectionFor).join("");
    if (selected) select(...selected);
  });

  // Deep link: #/plots?claim=<id> opens that claim's first point.
  if (params.claim) {
    for (const { plot, points } of plots) {
      const i = points.findIndex((p) => p.claim_id === params.claim);
      if (i >= 0) return select(plot.id, i);
    }
  }
}

// Paradigm shifts: is the field moving from method family A to family B, why,
// and what open problems does B have? The top chart is the external,
// uncurated check (arXiv abstract counts as a share of all LLM papers); the
// cards below join a rising/falling pair to the corpus's own lineage: the
// claims that bridge A to B, A's failures that motivated the move, and B's
// open problems.
import { load, fmt } from "../data.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

// Same labels and classes as the hypotheses view.
const BADGE = {
  unchecked: ["badge-unchecked", "novelty not checked"],
  open: ["badge-open", "open"],
  partial: ["badge-partial", "partially anticipated"],
  established: ["badge-established", "already established"],
  refuted: ["badge-refuted", "refuted"],
};

const claimLink = (cid) =>
  `<a class="mono" href="#/claims?claim=${encodeURIComponent(cid)}">${esc(cid)}</a>`;

const pct = (share, digits = 2) =>
  typeof share === "number" ? `${(share * 100).toFixed(digits)}%` : "—";

// Trend badge: an arrow icon + the class word, so the class never rides on
// color alone. The ratio is recent share / prior share over four quarters;
// an emerging family shows its short ratio (last two quarters / the four
// before), since that is what makes it emerging.
const TREND = {
  rising: ["▲", "rising"],
  emerging: ["△", "emerging"], // a turn too recent for the four-window ratio
  falling: ["▼", "falling"],
  flat: ["▬", "flat"],
};
function trendBadge(t) {
  if (!t || !TREND[t.class]) return "";
  const [icon, word] = TREND[t.class];
  const r = t.class === "emerging" && typeof t.short_ratio === "number" ? t.short_ratio : t.ratio;
  const ratio =
    typeof r === "number" ? ` ×${r.toFixed(r >= 10 ? 0 : 1)}` : t.class === "rising" ? " new" : "";
  const short = typeof t.short_ratio === "number" ? ` · last 2 quarters ×${t.short_ratio.toFixed(2)}` : "";
  const title = `recent share ${pct(t.recent_share)} vs prior ${pct(t.prior_share)}${short}${t.peak_window ? ` · peak ${t.peak_window}` : ""}`;
  return `<span class="trend trend-${esc(t.class)}" title="${esc(title)}"><span aria-hidden="true">${icon}</span> ${word}${esc(ratio)}</span>`;
}

function hypRow(h) {
  // A full hypothesis record carries novelty.status; a shift's to_hypotheses
  // summary may carry the status bare, as `status` or as a `novelty` string.
  const nov = h.novelty;
  const status = (typeof nov === "string" ? nov : (nov || {}).status) || h.status || "unchecked";
  const [cls, label] = BADGE[status] || BADGE.unchecked;
  return `<li><span class="badge ${cls}">${label}</span>
    <a href="#/hypotheses?id=${encodeURIComponent(h.hypothesis_id)}">${esc(h.statement)}</a>
    <span class="mono dim">${esc(h.hypothesis_id)}</span></li>`;
}

function failureRows(fails) {
  return (fails || [])
    .map(
      (f) => `<li><a class="mono" href="#/failure-modes?id=${encodeURIComponent(f.group_id)}">${esc(f.group_id)}</a>
        <span class="muted">· ${esc(f.symptom)} · ${fmt(Array.isArray(f.papers) ? f.papers.length : f.papers)} papers</span></li>`,
    )
    .join("");
}

// ---- chart ---------------------------------------------------------------

// Categorical slots in fixed order (dataviz reference palette; validated
// light on #ffffff and dark on #171b22). Past 8 families, the rest share
// the muted ink rather than a generated hue.
const SLOTS = 8;
const colorVar = (i) => (i < SLOTS ? `var(--s${i + 1})` : "var(--muted)");

function niceMax(v) {
  if (!(v > 0)) return 0.01;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * exp >= v) return m * exp;
  return 10 * exp;
}

function chartSvg(windows, fams, series, width) {
  const H = 300;
  const m = { l: 48, r: 16, t: 12, b: 28 };
  const w = Math.max(320, width);
  const iw = w - m.l - m.r;
  const ih = H - m.t - m.b;
  const shares = fams.flatMap((f) => (series[f] || []).map((p) => p.share || 0));
  const ymax = niceMax(Math.max(0, ...shares));
  const x = (i) => m.l + (windows.length > 1 ? (i / (windows.length - 1)) * iw : iw / 2);
  const y = (v) => m.t + ih - (v / ymax) * ih;
  const idx = new Map(windows.map((wn, i) => [wn, i]));

  const ticks = 4;
  const grid = [];
  for (let k = 0; k <= ticks; k++) {
    const v = (ymax / ticks) * k;
    const digits = ymax < 0.02 ? 1 : 0;
    grid.push(`<line class="grid${k === 0 ? " base" : ""}" x1="${m.l}" x2="${w - m.r}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="tick" x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${(v * 100).toFixed(digits)}%</text>`);
  }
  // Year labels on each Q1 window (or the first window of a year).
  const seen = new Set();
  const xl = windows
    .map((wn, i) => {
      const yr = String(wn).slice(0, 4);
      if (seen.has(yr)) return "";
      seen.add(yr);
      return `<line class="grid" x1="${x(i)}" x2="${x(i)}" y1="${m.t + ih}" y2="${m.t + ih + 4}"/>
        <text class="tick" x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(yr)}</text>`;
    })
    .join("");

  const lines = fams
    .map((f, fi) => {
      const pts = (series[f] || []).filter((p) => idx.has(p.window));
      if (!pts.length) return "";
      const d = pts
        .map((p, k) => `${k ? "L" : "M"}${x(idx.get(p.window)).toFixed(1)},${y(p.share || 0).toFixed(1)}`)
        .join("");
      const last = pts[pts.length - 1];
      return `<g class="series" data-fam="${esc(f)}" style="--c:${colorVar(fi)}">
        <path d="${d}"/>
        <circle class="end" cx="${x(idx.get(last.window))}" cy="${y(last.share || 0)}" r="4"/>
      </g>`;
    })
    .join("");

  return {
    svg: `<svg class="shift-svg" width="${w}" height="${H}" viewBox="0 0 ${w} ${H}" role="img"
      aria-label="Share of LLM papers on arXiv per quarter, one line per method family">
      ${grid.join("")}${xl}
      <g class="lines">${lines}</g>
      <line class="crosshair" x1="0" x2="0" y1="${m.t}" y2="${m.t + ih}" visibility="hidden"/>
      <rect class="hit" x="${m.l}" y="${m.t}" width="${iw}" height="${ih}" fill="transparent"/>
    </svg>`,
    x,
    m,
    iw,
  };
}

function drawChart(host, sh) {
  const series = sh.series || {};
  const fams = Object.keys(series);
  // Windows in baseline order; fall back to the union of series windows.
  let windows = (sh.baseline || []).map((b) => b.window);
  if (!windows.length) windows = [...new Set(fams.flatMap((f) => series[f].map((p) => p.window)))].sort();
  const byWin = new Map(windows.map((wn) => [wn, {}]));
  for (const f of fams) for (const p of series[f]) byWin.get(p.window) && (byWin.get(p.window)[f] = p);
  const base = new Map((sh.baseline || []).map((b) => [b.window, b.n]));

  const plot = host.querySelector(".shift-plot");
  const tip = host.querySelector(".shift-tip");
  let drawnWidth = 0;
  const render = () => {
    const width = plot.clientWidth || 900;
    if (width === drawnWidth) return; // the observer's first call, or a height-only change
    drawnWidth = width;
    const { svg, x, m, iw } = chartSvg(windows, fams, series, width);
    plot.innerHTML = svg;
    const el = plot.querySelector("svg");
    const cross = el.querySelector(".crosshair");
    const hit = el.querySelector(".hit");
    const move = (ev) => {
      const r = el.getBoundingClientRect();
      const px = ev.clientX - r.left;
      const i = Math.max(0, Math.min(windows.length - 1, Math.round(((px - m.l) / iw) * (windows.length - 1))));
      const cx = x(i);
      cross.setAttribute("x1", cx);
      cross.setAttribute("x2", cx);
      cross.setAttribute("visibility", "visible");
      const wn = windows[i];
      const row = byWin.get(wn) || {};
      tip.replaceChildren();
      const head = document.createElement("div");
      head.className = "tip-head";
      head.textContent = `${wn}${base.has(wn) ? ` · ${fmt(base.get(wn))} LLM papers` : ""}`;
      tip.appendChild(head);
      fams
        .map((f, fi) => [f, fi, row[f]])
        .sort((a, b) => ((b[2] || {}).share || 0) - ((a[2] || {}).share || 0))
        .forEach(([f, fi, p]) => {
          const line = document.createElement("div");
          line.className = "tip-row";
          const key = document.createElement("span");
          key.className = "tip-key";
          key.style.setProperty("--c", colorVar(fi));
          const val = document.createElement("b");
          val.textContent = p ? pct(p.share) : "—";
          const name = document.createElement("span");
          name.className = "muted";
          name.textContent = `${f}${p ? ` · ${fmt(p.n)}` : ""}`;
          line.append(key, val, name);
          tip.appendChild(line);
        });
      tip.hidden = false;
      const hr = host.getBoundingClientRect();
      const tw = tip.offsetWidth;
      let left = r.left - hr.left + cx + 14;
      if (left + tw > hr.width) left = r.left - hr.left + cx - tw - 14;
      tip.style.left = `${Math.max(0, left)}px`;
      tip.style.top = `${r.top - hr.top + m.t}px`;
    };
    hit.addEventListener("pointermove", move);
    hit.addEventListener("pointerleave", () => {
      cross.setAttribute("visibility", "hidden");
      tip.hidden = true;
    });
  };
  render();
  // Legend hover lifts one family's line and recedes the rest.
  host.querySelectorAll(".shift-legend [data-fam]").forEach((item) => {
    const set = (on) =>
      plot.querySelectorAll(".series").forEach((g) => {
        g.classList.toggle("dim", on && g.dataset.fam !== item.dataset.fam);
      });
    item.addEventListener("pointerenter", () => set(true));
    item.addEventListener("pointerleave", () => set(false));
    item.addEventListener("focus", () => set(true));
    item.addEventListener("blur", () => set(false));
  });
  let raf = 0;
  const ro = new ResizeObserver(() => {
    if (!plot.isConnected) return ro.disconnect(); // the view navigated away
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(render);
  });
  ro.observe(plot);
  return { windows, fams, byWin };
}

function tableHtml(windows, fams, byWin) {
  const head = fams.map((f) => `<th>${esc(f)}</th>`).join("");
  const rows = windows
    .map(
      (wn) =>
        `<tr><td class="mono">${esc(wn)}</td>${fams
          .map((f) => `<td class="mono">${pct(((byWin.get(wn) || {})[f] || {}).share)}</td>`)
          .join("")}</tr>`,
    )
    .join("");
  return `<div class="shift-table-wrap"><table class="shift-table"><thead><tr><th>quarter</th>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

// ---- cards ---------------------------------------------------------------

function card(s, trends, hyps, hypById, target) {
  const on = s.shift_id === target;
  const edges = s.bridge_edges || [];
  const edgeIds = new Set(edges.map((e) => e.claim_id));
  const extra = (s.bridge_claims || []).filter((c) => !edgeIds.has(c));
  const items = [
    ...edges.map(
      (e) => `<li>${esc(e.subject)} <span class="rel mono">${esc(e.relation)}</span> ${esc(e.object)}
        <span class="dim">— ${claimLink(e.claim_id)}</span></li>`,
    ),
    ...(extra.length ? [`<li class="hyp-cites">also: ${extra.map(claimLink).join(" ")}</li>`] : []),
  ];
  // Long lineages fold after the first few links; the rest stay one click away.
  const SHOWN = 6;
  const bridge =
    items.slice(0, SHOWN).join("") +
    (items.length > SHOWN
      ? `<li class="sh-more"><details><summary class="muted">${fmt(items.length - SHOWN)} more</summary><ul>${items.slice(SHOWN).join("")}</ul></details></li>`
      : "");
  const fromF = failureRows(s.from_failures);
  const toF = failureRows(s.to_failures);
  const own = new Set(hyps.map((h) => h.hypothesis_id));
  const toH = (s.to_hypotheses || [])
    .filter((h) => !own.has(h.hypothesis_id))
    .map((h) => hypById.get(h.hypothesis_id) || h);
  const from = s.from;
  const to = s.to;
  return `
    <section class="card fm sh${on ? " target" : ""}" id="sh-${esc(s.shift_id)}">
      <div class="fm-head">
        <h2>${esc(from)} → ${esc(to)}</h2>
        <span class="sh-trend">${esc(from)} ${trendBadge(s.from_trend || trends[from])}</span>
        <span class="sh-trend">${esc(to)} ${trendBadge(s.to_trend || trends[to])}</span>
        ${s.hooked ? `<span class="badge badge-gen">hooked</span>` : ""}
        <span class="muted mono fm-counts">${fmt((s.bridge_claims || []).length)} bridge claims · ${fmt((s.bridge_papers || []).length)} papers</span>
      </div>
      <div class="mono dim fm-id">${esc(s.shift_id)}</div>
      ${bridge ? `<div class="fm-sec"><b>Bridge claims.</b><ul>${bridge}</ul></div>` : `<div class="fm-sec muted">No claim in the corpus links ${esc(from)} to ${esc(to)}.</div>`}
      ${fromF ? `<div class="fm-sec"><b>${esc(from)}'s failures that motivated the move.</b><ul>${fromF}</ul></div>` : ""}
      ${toF ? `<div class="fm-sec"><b>${esc(to)}'s open problems.</b><ul>${toF}</ul></div>` : ""}
      ${hyps.length ? `<div class="fm-sec"><b>Hypotheses for this shift.</b><ul class="fm-hyps">${hyps.map(hypRow).join("")}</ul></div>` : ""}
      ${toH.length ? `<div class="fm-sec"><b>Hypotheses on ${esc(to)}.</b><ul class="fm-hyps">${toH.map(hypRow).join("")}</ul></div>` : ""}
    </section>`;
}

export async function render(root, params = {}) {
  const d = await load("discoveries");
  const sh = d.shifts;
  if (!sh || !Object.keys(sh.series || {}).length) {
    root.innerHTML = `<h1>Shifts</h1>
      <p class="lead">This domain has no paradigm-shift data. It is mined from
      an external arXiv trend feed by <span class="mono">mine_shifts.py</span>,
      for domains whose <span class="mono">[stages].trends</span> is on.</p>`;
    return;
  }
  const trends = sh.trends || {};
  const byHook = new Map();
  for (const h of d.hypotheses || []) {
    if (h.generator !== "paradigm_shift") continue;
    if (!byHook.has(h.hook_id)) byHook.set(h.hook_id, []);
    byHook.get(h.hook_id).push(h);
  }
  const hypById = new Map((d.hypotheses || []).map((h) => [h.hypothesis_id, h]));
  const fams = Object.keys(sh.series);
  const all = sh.shifts || [];
  const s = sh.stats || {};
  const target = params.id || "";
  const last = (sh.baseline || []).at(-1);

  const legend = fams
    .map(
      (f, i) => `<span class="shift-leg" tabindex="0" data-fam="${esc(f)}">
        <span class="line-key" style="--c:${colorVar(i)}"></span><span>${esc(f)}</span>
        ${trendBadge(trends[f])}</span>`,
    )
    .join("");

  root.innerHTML = `
    <h1>Shifts</h1>
    <p class="lead">Is the field moving from one method family to another? A
      shift pairs a rising or emerging family with one it moves away from
      (a family that is not growing), and joins them to this corpus: the claims that link them, the first family's failures that
      motivated the move, and the second family's open problems. The trend is
      counted outside the corpus, so curation does not shape it.</p>
    <div class="grid stat-row">
      <div class="card stat"><div class="n">${fmt(s.families ?? fams.length)}</div><div class="k">families</div></div>
      <div class="card stat"><div class="n">${fmt((s.rising || []).length)}</div><div class="k">rising</div></div>
      <div class="card stat"><div class="n">${fmt((s.falling || []).length)}</div><div class="k">falling</div></div>
      <div class="card stat"><div class="n">${fmt(s.shifts ?? all.length)}</div><div class="k">shifts</div></div>
      <div class="card stat"><div class="n">${fmt(s.hooked ?? all.filter((x) => x.hooked).length)}</div><div class="k">hooked</div></div>
    </div>
    <section class="card shift-chart">
      <h2>Share of LLM papers on arXiv, per quarter</h2>
      <div class="shift-legend">${legend}</div>
      <div class="shift-plot"></div>
      <div class="shift-tip" hidden></div>
      <p class="muted shift-source">External, uncurated: arXiv abstract counts
        (<span class="mono">${esc(sh.source)}</span>${sh.fetched_at ? `, fetched ${esc(String(sh.fetched_at).slice(0, 10))}` : ""}).
        Families overlap; shares, not a partition. The last quarter is partial
        and is excluded${last ? ` (series end ${esc(last.window)})` : ""}.</p>
      <details class="shift-data"><summary class="muted">data table</summary><div id="table"></div></details>
    </section>
    <h2 class="sh-list-head">${fmt(all.length)} shifts</h2>
    <div id="list"></div>`;

  const chart = drawChart(root.querySelector(".shift-chart"), sh);
  root.querySelector("#table").innerHTML = tableHtml(chart.windows, chart.fams, chart.byWin);
  root.querySelector("#list").innerHTML =
    all.map((x) => card(x, trends, byHook.get(x.shift_id) || [], hypById, target)).join("") ||
    `<div class="empty">No rising family has a falling family to shift from.</div>`;
  if (target) {
    const el = root.querySelector(`#sh-${CSS.escape(target)}`);
    if (el) el.scrollIntoView({ block: "center" });
  }
}

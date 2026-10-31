// Failure-mode catalogue: result rows grouped by (method family, symptom),
// with the conditions the symptom appears under, the causes papers state,
// the rows where it did NOT appear, and the hypotheses synthesised from it.
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

// {value: count} -> chips, most frequent first; `limit` caps long tails.
function countChips(label, counts, limit = 6) {
  const entries = Object.entries(counts || {}).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return "";
  const shown = entries.slice(0, limit);
  const more = entries.length - shown.length;
  return `<div class="fm-cond"><span class="legend-label">${esc(label)}</span>
    ${shown.map(([v, n]) => `<span class="chip">${esc(v)} <span class="muted">${fmt(n)}</span></span>`).join("")}
    ${more > 0 ? `<span class="muted">+${fmt(more)} more</span>` : ""}</div>`;
}

function sizeChip(sizes) {
  const xs = (sizes || []).filter((x) => typeof x === "number" && isFinite(x));
  if (!xs.length) return "";
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const range = lo === hi ? `${lo}B` : `${lo}B – ${hi}B`;
  return `<div class="fm-cond"><span class="legend-label">size</span><span class="chip">${esc(range)}</span></div>`;
}

function hypRow(h) {
  const status = (h.novelty || {}).status || "unchecked";
  const [cls, label] = BADGE[status] || BADGE.unchecked;
  return `<li><span class="badge ${cls}">${label}</span>
    <a href="#/hypotheses?id=${encodeURIComponent(h.hypothesis_id)}">${esc(h.statement)}</a>
    <span class="mono dim">${esc(h.hypothesis_id)}</span></li>`;
}

function card(g, hyps, target, nOpps, rising) {
  const c = g.conditions || {};
  const on = g.group_id === target;
  const causes = (g.stated_causes || [])
    .map((sc) => `<li>${esc(sc.cause)} <span class="dim">— ${claimLink(sc.claim_id)}</span></li>`)
    .join("");
  const counter = (g.counter_claims || []).map(claimLink).join(" ");
  const conds = [
    countChips("base model", c.base_model_family),
    countChips("variant", c.variant),
    countChips("reward", c.reward),
    countChips("benchmarks", c.benchmarks, 5),
    sizeChip(c.size_b),
  ].join("");
  return `
    <section class="card fm${on ? " target" : ""}" id="fm-${esc(g.group_id)}">
      <div class="fm-head">
        <h2>${esc(g.method_family)} · ${esc(g.symptom)}</h2>
        ${rising ? `<a class="chip chip-rising" href="#/shifts" title="this family's share of arXiv LLM papers is rising">▲ rising family</a>` : ""}
        ${g.hooked ? `<span class="badge badge-gen">hooked</span>` : ""}
        <span class="muted mono fm-counts">${fmt((g.claims || []).length)} claims · ${fmt((g.papers || []).length)} papers</span>
      </div>
      <div class="mono dim fm-id">${esc(g.group_id)}</div>
      ${conds ? `<div class="fm-conds">${conds}</div>` : ""}
      ${causes ? `<div class="fm-sec"><b>Stated causes.</b><ul>${causes}</ul></div>` : ""}
      ${counter ? `<div class="fm-sec hyp-cites"><b>Did not show under:</b> ${counter}</div>` : ""}
      ${nOpps ? `<div class="fm-sec"><a href="#/opportunities?group=${encodeURIComponent(g.group_id)}">Transfer opportunities: ${fmt(nOpps)}</a></div>` : ""}
      ${hyps.length ? `<div class="fm-sec"><b>Hypotheses.</b><ul class="fm-hyps">${hyps.map(hypRow).join("")}</ul></div>` : ""}
      <details class="fm-claims hyp-cites"><summary class="muted">supporting claims</summary>
        ${(g.claims || []).map(claimLink).join(" ")}</details>
    </section>`;
}

export async function render(root, params = {}) {
  const d = await load("discoveries");
  const fm = d.failure_modes;
  if (!fm || !(fm.groups || []).length) {
    root.innerHTML = `<h1>Failure modes</h1>
      <p class="lead">This domain has no failure-mode catalogue. It is mined
      from typed result rows by <span class="mono">mine_failure_modes.py</span>,
      for domains whose discovery stage declares one.</p>`;
    return;
  }
  const byHook = new Map();
  for (const h of d.hypotheses || []) {
    if (h.generator !== "failure_mode") continue;
    if (!byHook.has(h.hook_id)) byHook.set(h.hook_id, []);
    byHook.get(h.hook_id).push(h);
  }
  // Fix-transfer opportunities that target each group (absent data -> none).
  const oppsByGroup = new Map();
  for (const o of (d.opportunities || {}).opportunities || []) {
    oppsByGroup.set(o.target_group, (oppsByGroup.get(o.target_group) || 0) + 1);
  }
  // Families whose external arXiv share is rising (absent shifts data -> none).
  const trends = (d.shifts || {}).trends || {};
  const rising = (fam) => (trends[fam] || {}).class === "rising";
  // Hooked groups first, then by how many papers report the symptom.
  const groups = [...fm.groups].sort(
    (a, b) =>
      Number(!!b.hooked) - Number(!!a.hooked) ||
      (b.papers || []).length - (a.papers || []).length ||
      String(a.group_id).localeCompare(String(b.group_id)),
  );
  const target = params.id || "";
  const s = fm.stats || {};
  let q = "";

  root.innerHTML = `
    <h1>Failure modes</h1>
    <p class="lead">Result rows grouped by method family and symptom: the
      conditions each symptom was reported under, the causes the papers
      state, and the rows from the same family where it did <b>not</b> show.
      A group reported by at least two papers is <b>hooked</b> and gets a
      cause hypothesis. The conditions are what the papers state, not a
      controlled comparison.</p>
    <div class="grid stat-row">
      <div class="card stat"><div class="n">${fmt(s.groups ?? groups.length)}</div><div class="k">groups</div></div>
      <div class="card stat"><div class="n">${fmt(s.hooked ?? groups.filter((g) => g.hooked).length)}</div><div class="k">hooked</div></div>
      <div class="card stat"><div class="n">${fmt(s.results ?? 0)}</div><div class="k">result rows</div></div>
      <div class="card stat"><div class="n">${fmt([...byHook.values()].reduce((n, xs) => n + xs.length, 0))}</div><div class="k">hypotheses</div></div>
    </div>
    <div class="toolbar">
      <input type="search" id="q" placeholder="Search family, symptom, cause, or id…" />
      <span class="muted mono" id="count"></span>
    </div>
    <div id="list"></div>`;

  const list = root.querySelector("#list");
  const countEl = root.querySelector("#count");

  const filtered = () => {
    const needle = q.toLowerCase();
    if (!needle) return groups;
    return groups.filter((g) =>
      [g.group_id, g.method_family, g.symptom, ...(g.stated_causes || []).map((c) => c.cause)].some(
        (v) => String(v ?? "").toLowerCase().includes(needle),
      ),
    );
  };

  function draw() {
    const rows = filtered();
    countEl.textContent = `${fmt(rows.length)} of ${fmt(groups.length)}`;
    list.innerHTML =
      rows
        .map((g) =>
          card(g, byHook.get(g.group_id) || [], target, oppsByGroup.get(g.group_id) || 0, rising(g.method_family)),
        )
        .join("") ||
      `<div class="empty">No failure modes match.</div>`;
  }

  root.querySelector("#q").addEventListener("input", (e) => {
    q = e.target.value;
    draw();
  });

  draw();
  if (target) {
    const el = root.querySelector(`#fm-${CSS.escape(target)}`);
    if (el) el.scrollIntoView({ block: "center" });
  }
}

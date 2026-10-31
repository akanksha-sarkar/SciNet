// Fix-transfer opportunities: a fix that removes a symptom in one method
// family, and a failure-mode group where the same symptom shows in another
// family that no paper has tried the fix in. Answers "given my technique
// family and benchmarks, which fixes from other families could I try?"
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

const options = (values, all) =>
  [["", all], ...values.map((v) => [v, v])]
    .map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`)
    .join("");

const uniq = (xs) => [...new Set(xs.filter((x) => x != null && x !== ""))].sort();

// {benchmark: count} -> chips, most frequent first.
function benchChips(counts, limit = 6) {
  const entries = Object.entries(counts || {}).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return "";
  const shown = entries.slice(0, limit);
  const more = entries.length - shown.length;
  return `<div class="fm-cond"><span class="legend-label">benchmarks</span>
    ${shown.map(([v, n]) => `<span class="chip">${esc(v)} <span class="muted">${fmt(n)}</span></span>`).join("")}
    ${more > 0 ? `<span class="muted">+${fmt(more)} more</span>` : ""}</div>`;
}

function hypRow(h) {
  const status = (h.novelty || {}).status || "unchecked";
  const [cls, label] = BADGE[status] || BADGE.unchecked;
  return `<li><span class="badge ${cls}">${label}</span>
    <a href="#/hypotheses?id=${encodeURIComponent(h.hypothesis_id)}">${esc(h.statement)}</a>
    <span class="mono dim">${esc(h.hypothesis_id)}</span></li>`;
}

function card(o, hyps, target) {
  const on = o.opportunity_id === target;
  const sources = (o.source_families || []).map(esc).join(", ");
  const fixClaims = (o.fix_claims || []).map(claimLink).join(" ");
  const causes = (o.stated_causes || [])
    .map((sc) => `<li>${esc(sc.cause)} <span class="dim">— ${claimLink(sc.claim_id)}</span></li>`)
    .join("");
  return `
    <section class="card fm op${on ? " target" : ""}" id="op-${esc(o.opportunity_id)}">
      <div class="fm-head">
        <h2>${esc(o.fix)} → ${esc(o.target_family)}</h2>
        <span class="chip">${esc(o.symptom)}</span>
        ${o.hooked ? `<span class="badge badge-gen">hooked</span>` : ""}
        <span class="muted mono fm-counts">fix year ${o.fix_year_max != null ? esc(o.fix_year_max) : "—"} · ${fmt((o.fix_papers || []).length)} fix papers</span>
      </div>
      <div class="mono dim fm-id">${esc(o.opportunity_id)}</div>
      <div class="fm-sec hyp-cites">fixes <b>${esc(o.symptom)}</b> in ${sources || "—"}: ${fixClaims}</div>
      <div class="fm-sec">target group
        <a class="mono" href="#/failure-modes?id=${encodeURIComponent(o.target_group)}">${esc(o.target_group)}</a>
        <span class="muted">· ${fmt((o.target_papers || []).length)} papers show ${esc(o.symptom)} in ${esc(o.target_family)}</span></div>
      ${benchChips(o.benchmarks) ? `<div class="fm-conds">${benchChips(o.benchmarks)}</div>` : ""}
      ${causes ? `<div class="fm-sec"><b>Stated causes in ${esc(o.target_family)}.</b><ul>${causes}</ul></div>` : ""}
      ${hyps.length ? `<div class="fm-sec"><b>Hypotheses.</b><ul class="fm-hyps">${hyps.map(hypRow).join("")}</ul></div>` : ""}
    </section>`;
}

export async function render(root, params = {}) {
  const d = await load("discoveries");
  const op = d.opportunities;
  if (!op || !(op.opportunities || []).length) {
    root.innerHTML = `<h1>Opportunities</h1>
      <p class="lead">This domain has no fix-transfer opportunities. They are
      mined from fix records and the failure-mode catalogue by
      <span class="mono">mine_opportunities.py</span>, for domains whose
      discovery stage declares one.</p>`;
    return;
  }
  const byHook = new Map();
  for (const h of d.hypotheses || []) {
    if (h.generator !== "fix_transfer") continue;
    if (!byHook.has(h.hook_id)) byHook.set(h.hook_id, []);
    byHook.get(h.hook_id).push(h);
  }
  // The file is already ranked (hooked first); keep that order.
  const all = op.opportunities;
  const years = all.map((o) => o.fix_year_max).filter((y) => typeof y === "number");
  const newest = years.length ? Math.max(...years) : null;
  const families = uniq(all.map((o) => o.target_family));
  const symptoms = uniq(all.map((o) => o.symptom));
  const benchmarks = uniq(all.flatMap((o) => Object.keys(o.benchmarks || {})));
  const s = op.stats || {};

  // ?id= highlights one opportunity; ?group= narrows to one failure-mode
  // group (the failure-modes view links here).
  const target = params.id || "";
  const group = params.group || "";
  let q = "";
  let family = "";
  let symptom = "";
  let bench = "";
  let emerging = false;

  root.innerHTML = `
    <h1>Opportunities</h1>
    <p class="lead">Fixes that remove a symptom in one method family, paired
      with a failure-mode group where the same symptom shows in another family
      and no paper reports trying the fix. Pick your family and benchmarks to
      see which fixes from elsewhere you could try. An opportunity is an
      untested pairing, not evidence that the fix transfers.</p>
    <div class="grid stat-row">
      <div class="card stat"><div class="n">${fmt(s.opportunities ?? all.length)}</div><div class="k">opportunities</div></div>
      <div class="card stat"><div class="n">${fmt(s.hooked ?? all.filter((o) => o.hooked).length)}</div><div class="k">hooked</div></div>
      <div class="card stat"><div class="n">${fmt(s.fix_records ?? 0)}</div><div class="k">fix records</div></div>
      <div class="card stat"><div class="n">${fmt([...byHook.values()].reduce((n, xs) => n + xs.length, 0))}</div><div class="k">hypotheses</div></div>
    </div>
    ${group ? `<p class="muted">Showing opportunities for group <span class="mono">${esc(group)}</span> · <a href="#/opportunities">show all</a></p>` : ""}
    <div class="toolbar">
      <select id="family">${options(families, "All target families")}</select>
      <select id="symptom">${options(symptoms, "All symptoms")}</select>
      <input type="search" id="bench" list="bench-list" placeholder="Benchmark…" class="op-bench" />
      <datalist id="bench-list">${benchmarks.map((b) => `<option value="${esc(b)}"></option>`).join("")}</datalist>
      <input type="search" id="q" placeholder="Search fix, family, cause, or id…" />
      ${newest != null ? `<label class="op-toggle"><input type="checkbox" id="emerging" /> emerging only (fix evidence ≥ ${newest - 1})</label>` : ""}
      <span class="muted mono" id="count"></span>
    </div>
    <div id="list"></div>`;

  const list = root.querySelector("#list");
  const countEl = root.querySelector("#count");

  const filtered = () => {
    const needle = q.toLowerCase();
    const bneedle = bench.toLowerCase();
    return all.filter((o) => {
      if (group && o.target_group !== group) return false;
      if (family && o.target_family !== family) return false;
      if (symptom && o.symptom !== symptom) return false;
      if (emerging && !(typeof o.fix_year_max === "number" && o.fix_year_max >= newest - 1))
        return false;
      if (bneedle && !Object.keys(o.benchmarks || {}).some((b) => b.toLowerCase().includes(bneedle)))
        return false;
      if (!needle) return true;
      return [
        o.opportunity_id,
        o.fix,
        o.symptom,
        o.target_family,
        ...(o.source_families || []),
        ...(o.stated_causes || []).map((c) => c.cause),
      ].some((v) => String(v ?? "").toLowerCase().includes(needle));
    });
  };

  function draw() {
    const rows = filtered();
    countEl.textContent = `${fmt(rows.length)} of ${fmt(all.length)}`;
    list.innerHTML =
      rows.map((o) => card(o, byHook.get(o.opportunity_id) || [], target)).join("") ||
      `<div class="empty">No opportunities match.</div>`;
  }

  const on = (sel, ev, fn) => root.querySelector(sel)?.addEventListener(ev, fn);
  on("#q", "input", (e) => {
    q = e.target.value;
    draw();
  });
  on("#bench", "input", (e) => {
    bench = e.target.value;
    draw();
  });
  on("#family", "change", (e) => {
    family = e.target.value;
    draw();
  });
  on("#symptom", "change", (e) => {
    symptom = e.target.value;
    draw();
  });
  on("#emerging", "change", (e) => {
    emerging = e.target.checked;
    draw();
  });

  draw();
  if (target) {
    const el = root.querySelector(`#op-${CSS.escape(target)}`);
    if (el) el.scrollIntoView({ block: "center" });
  }
}

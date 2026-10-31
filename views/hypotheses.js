import { load, fmt } from "../data.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

const BADGE = {
  unchecked: ["badge-unchecked", "novelty not checked"],
  open: ["badge-open", "open"],
  partial: ["badge-partial", "partially anticipated"],
  established: ["badge-established", "already established"],
  refuted: ["badge-refuted", "refuted"],
};
const ORDER = { refuted: 0, open: 1, partial: 2, established: 3, unchecked: 4 };
const STATUS_OPTIONS = [
  ["", "All statuses"],
  ["open", "Open"],
  ["partial", "Partially anticipated"],
  ["established", "Already established"],
  ["refuted", "Refuted"],
  ["unchecked", "Not checked"],
];

// Which synthesiser produced the hypothesis. Rows written before the field
// existed carry none and get no badge.
const GENERATOR = {
  failure_mode: "failure mode",
  fix_transfer: "fix transfer",
  paradigm_shift: "paradigm shift",
  anomaly_hook: "anomaly",
  bridged_gap: "bridged gap",
};
const GENERATOR_OPTIONS = [["", "All generators"], ...Object.entries(GENERATOR)];

const citeHref = (c) =>
  c.kind === "pmid"
    ? `https://pubmed.ncbi.nlm.nih.gov/${encodeURIComponent(c.id)}/`
    : c.kind === "arxiv"
      ? `https://arxiv.org/abs/${encodeURIComponent(c.id)}`
      : `https://doi.org/${encodeURIComponent(c.id)}`;

// A failure-mode hypothesis's hook IS a failure-mode group, and a
// fix-transfer hypothesis's hook IS an opportunity, and a paradigm-shift
// hypothesis's hook IS a shift: link to each.
const HOOK_VIEW = {
  failure_mode: "failure-modes",
  fix_transfer: "opportunities",
  paradigm_shift: "shifts",
};
const hookHtml = (h) =>
  HOOK_VIEW[h.generator]
    ? `hook <a class="mono" href="#/${HOOK_VIEW[h.generator]}?id=${encodeURIComponent(h.hook_id)}">${esc(h.hook_id)}</a>`
    : `hook ${esc(h.hook_id)}`;

function card(h, target) {
  const nov = h.novelty || {};
  const status = nov.status || "unchecked";
  const [cls, label] = BADGE[status] || BADGE.unchecked;
  const cites = (h.cites || [])
    .map((c) => `<a class="mono" href="#/claims?claim=${encodeURIComponent(c)}">${esc(c)}</a>`)
    .join(" ");
  const refs = (nov.citations || [])
    .map(
      (c) => `<li><a href="${citeHref(c)}" target="_blank" rel="noopener">${esc(c.title || c.id)}</a>
        <span class="mono dim">${esc(c.kind)}:${esc(c.id)} · ${esc(c.role)}</span></li>`,
    )
    .join("");
  const gen = GENERATOR[h.generator]
    ? `<span class="badge badge-gen">${GENERATOR[h.generator]}</span>`
    : "";
  const on = h.hypothesis_id === target;
  const decided = nov.decided_by
    ? `<span class="mono dim">verdict by ${esc(nov.decided_by)} · ${esc((nov.decided_at || "").slice(0, 10))}</span>`
    : "";
  // Collapsed by default: the badge + statement is the headline, everything
  // else (mechanism/prediction/test/evidence) opens on click.
  return `
    <details class="card hyp${on ? " target" : ""}" id="hyp-${esc(h.hypothesis_id)}"
      data-status="${esc(status)}"${on ? " open" : ""}>
      <summary>
        <span class="hyp-badges"><span class="badge ${cls}">${label}</span>${gen}</span>
        <span class="mono dim">${esc(h.hypothesis_id)}</span>
        <span class="hyp-statement">${esc(h.statement)}</span>
        ${decided}
      </summary>
      <div class="hyp-body">
        <p class="mono dim">${hookHtml(h)}</p>
        <p><b>Mechanism.</b> ${esc(h.mechanism)}</p>
        <p><b>Prediction.</b> ${esc(h.prediction)}</p>
        <p><b>Test.</b> ${esc(h.test)}</p>
        <div class="hyp-cites">evidence: ${cites}</div>
        ${nov.note ? `<p class="dim"><b>Literature check.</b> ${esc(nov.note)}</p>` : ""}
        ${refs ? `<ul class="hyp-cites">${refs}</ul>` : ""}
      </div>
    </details>`;
}

export async function render(root, params = {}) {
  const d = await load("discoveries");
  const s = d.stats || {};
  if (!s.hypotheses) {
    root.innerHTML = `<h1>Hypotheses</h1>
      <p class="lead">No hypotheses yet for this domain. Enable the discovery
      stage with <span class="mono">[stages].discovery = true</span> in the
      domain's <span class="mono">domain.toml</span>, then run
      <span class="mono">run_pipeline.py --stage discover --run</span>.</p>`;
    return;
  }
  const hyps = [...(d.hypotheses || [])].sort((a, b) => {
    const ra = ORDER[(a.novelty || {}).status] ?? ORDER.unchecked;
    const rb = ORDER[(b.novelty || {}).status] ?? ORDER.unchecked;
    return ra - rb || String(a.hypothesis_id).localeCompare(String(b.hypothesis_id));
  });

  // ?id=<hypothesis_id> opens, highlights and scrolls to one hypothesis
  // (the failure-modes view links here).
  const target = params.id || "";
  let q = "";
  let status = "";
  let generator = "";
  const hasGenerators = hyps.some((h) => GENERATOR[h.generator]);

  root.innerHTML = `
    <h1>Hypotheses</h1>
    <p class="lead">Explanations synthesised from anomalies this corpus records
      but does not explain, each grounded in claims from at least two papers.
      Every verdict below comes from a literature search whose citations were
      resolved against NCBI, Crossref, DataCite or arXiv; <b>open</b> means one search found no
      prior statement of it, not that none exists. <b>Refuted</b> means a
      source directly tested this specific claim and reported it does not
      hold — check that one before spending time testing it. Anything marked
      <b>novelty not checked</b> is a candidate, not a finding.</p>
    <div class="grid stat-row" id="stats">
      <button type="button" class="card stat stat-filter" data-status=""><div class="n">${fmt(s.hypotheses)}</div><div class="k">hypotheses</div></button>
      <button type="button" class="card stat stat-filter" data-status="open"><div class="n">${fmt(s.open || 0)}</div><div class="k">open</div></button>
      <button type="button" class="card stat stat-filter" data-status="partial"><div class="n">${fmt(s.partial || 0)}</div><div class="k">partially anticipated</div></button>
      <button type="button" class="card stat stat-filter" data-status="established"><div class="n">${fmt(s.established || 0)}</div><div class="k">already established</div></button>
      <button type="button" class="card stat stat-filter" data-status="refuted"><div class="n">${fmt(s.refuted || 0)}</div><div class="k">refuted</div></button>
      <button type="button" class="card stat stat-filter" data-status="unchecked"><div class="n">${fmt(s.unchecked || 0)}</div><div class="k">not checked</div></button>
    </div>
    <div class="toolbar">
      <input type="search" id="q" placeholder="Search statement, mechanism, prediction, test, or id…" />
      <select id="status">${STATUS_OPTIONS.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("")}</select>
      ${hasGenerators ? `<select id="generator">${GENERATOR_OPTIONS.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("")}</select>` : ""}
      <button type="button" class="btn" id="expand-all">Expand all</button>
      <button type="button" class="btn" id="collapse-all">Collapse all</button>
      <span class="muted mono" id="count"></span>
    </div>
    <div id="list"></div>`;

  const list = root.querySelector("#list");
  const countEl = root.querySelector("#count");
  const statusSelect = root.querySelector("#status");

  const filtered = () => {
    const needle = q.toLowerCase();
    return hyps.filter((h) => {
      const st = (h.novelty || {}).status || "unchecked";
      if (status && st !== status) return false;
      if (generator && h.generator !== generator) return false;
      if (!needle) return true;
      return [h.statement, h.mechanism, h.prediction, h.test, h.hypothesis_id, h.hook_id].some((v) =>
        String(v ?? "").toLowerCase().includes(needle),
      );
    });
  };

  function draw() {
    const rows = filtered();
    countEl.textContent = `${fmt(rows.length)} of ${fmt(hyps.length)}`;
    list.innerHTML =
      rows.map((h) => card(h, target)).join("") || `<div class="empty">No hypotheses match.</div>`;
    root.querySelectorAll(".stat-filter").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.status === status);
    });
  }

  root.querySelector("#q").addEventListener("input", (e) => {
    q = e.target.value;
    draw();
  });
  statusSelect.addEventListener("change", (e) => {
    status = e.target.value;
    draw();
  });
  root.querySelector("#generator")?.addEventListener("change", (e) => {
    generator = e.target.value;
    draw();
  });
  root.querySelector("#stats").addEventListener("click", (e) => {
    const btn = e.target.closest(".stat-filter");
    if (!btn) return;
    status = status === btn.dataset.status ? "" : btn.dataset.status;
    statusSelect.value = status;
    draw();
  });
  root.querySelector("#expand-all").addEventListener("click", () => {
    list.querySelectorAll("details.hyp").forEach((el) => (el.open = true));
  });
  root.querySelector("#collapse-all").addEventListener("click", () => {
    list.querySelectorAll("details.hyp").forEach((el) => (el.open = false));
  });

  draw();
  if (target) {
    const el = root.querySelector(`#hyp-${CSS.escape(target)}`);
    if (el) el.scrollIntoView({ block: "center" });
  }
}

import { load, fmt } from "../data.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

function circuits(c) {
  if (!c) return `<p class="dim">No relation graph, so no circuit census.</p>`;
  const s = c.stats || {};
  const inc = (c.ffl || []).filter((f) => f.kind === "incoherent");
  const scored = inc.filter((f) => f.corroboration !== null);
  const withCorr = scored.filter((f) => f.corroboration.n_claims > 0);
  const withCorrValue =
    scored.length === 0
      ? `<span class="dim" style="font-size:16px">not checked</span>`
      : fmt(withCorr.length);
  const rows = inc
    .slice(0, 40)
    .map(
      (f) => `<tr><td class="mono">${esc(f.x)} ${esc(f.signs[0])} ${esc(f.y)} ${esc(
        f.signs[1],
      )} ${esc(f.z)}</td><td class="num">${f.papers.length}</td><td>${
        f.corroboration === null
          ? "<span class='dim'>not checked</span>"
          : f.corroboration.n_claims || 0
      }</td></tr>`,
    )
    .join("");
  return `
    <div class="grid stat-row">
      <div class="card stat"><div class="n">${fmt(s.feedback_2 || 0)}</div><div class="k">feedback loops</div></div>
      <div class="card stat"><div class="n">${fmt(s.ffl || 0)}</div><div class="k">feed-forward loops</div></div>
      <div class="card stat"><div class="n">${fmt(s.ffl_incoherent || 0)}</div><div class="k">incoherent</div></div>
      <div class="card stat"><div class="n">${withCorrValue}</div><div class="k">circuits discussed dynamically</div></div>
    </div>
    <p class="dim">An incoherent loop is the motif that generates adaptation and
      fold-change detection. "Discussed dynamically" counts claims that mention
      both endpoints alongside dynamics vocabulary (e.g. "dynamic", "adapt") —
      keyword co-occurrence, not a measurement of the circuit. Loops marked
      not checked belong to a domain that declares no corroboration_terms, so
      no pass ran for them at all — distinct from a pass running and finding
      zero matching claims, which renders 0. Either way, an unconfirmed loop
      is a prediction, not a finding.</p>
    <div class="scroll"><table><thead><tr><th>circuit</th><th class="num">papers</th>
      <th>discussed</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export async function render(root) {
  const d = await load("discoveries");
  const s = d.stats || {};
  if (!s.hooks && !s.fragility && !s.coverage) {
    root.innerHTML = `<h1>Audit</h1>
      <p class="lead">The discovery stage has not run for this domain, so there
      is no audit yet. Enable it with
      <span class="mono">[stages].discovery = true</span> in the domain's
      <span class="mono">domain.toml</span>, then run
      <span class="mono">run_pipeline.py --stage discover --run</span>.</p>`;
    return;
  }
  const frag = (d.fragility || [])
    .map(
      (f) => `<tr><td>${esc(f.category)}</td><td class="mono">${esc(f.claim_id)}</td>
        <td>${esc((f.text || "").slice(0, 180))}</td></tr>`,
    )
    .join("");
  const covRows = ((d.coverage || {}).rows || [])
    .map(
      (r) => `<tr><td class="mono">${esc(r.a)}</td><td class="mono">${esc(r.c)}</td>
        <td class="num">${fmt(r.score)}</td><td class="num">${fmt(r.n_bridges)}</td></tr>`,
    )
    .join("");
  root.innerHTML = `
    <h1>Audit</h1>
    <p class="lead">Deterministic checks over the corpus: the signed circuit
      census, claims whose own text marks their support as weak, and relations
      the corpus may be missing. None of this is a hypothesis; hypotheses live
      on their own tab.</p>
    <div class="grid stat-row">
      <div class="card stat"><div class="n">${fmt(s.hooks)}</div><div class="k">anomaly hooks</div></div>
      <div class="card stat"><div class="n">${fmt(s.fragility)}</div><div class="k">fragile claims</div></div>
      <div class="card stat"><div class="n">${fmt(s.coverage)}</div><div class="k">coverage gaps</div></div>
      <div class="card stat"><div class="n">${fmt(((d.circuits || {}).stats || {}).ffl_incoherent || 0)}</div><div class="k">incoherent loops</div></div>
    </div>
    <p class="dim">Anomaly hooks are the claims that report a failed method, a
      violated expectation, or a stated unknown; they are the input to
      hypothesis synthesis and are listed with each hypothesis.</p>
    <h2>Circuits</h2>
    ${circuits(d.circuits)}
    <h2>Evidence fragility</h2>
    <p class="dim">Claims whose own text marks their support as unpublished,
      contested, or a single study.</p>
    <div class="scroll"><table><thead><tr><th>category</th><th>claim</th><th>text</th>
      </tr></thead><tbody>${frag}</tbody></table></div>
    <h2>Coverage gaps</h2>
    <p class="dim">Relations this corpus may be missing — a curation aid, not
      hypotheses. ${fmt((d.coverage || {}).total || 0)} rows, showing the first
      ${fmt(((d.coverage || {}).rows || []).length)}.</p>
    <div class="scroll"><table><thead><tr><th>entity</th><th>entity</th>
      <th class="num">score</th><th class="num">bridges</th></tr></thead>
      <tbody>${covRows}</tbody></table></div>`;
}

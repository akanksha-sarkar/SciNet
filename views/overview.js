import { load, loadDomains, getDomain, fmt, makeTypeColor } from "../data.js";

const bars = (obj, colorFn) => {
  const max = Math.max(1, ...Object.values(obj));
  return Object.entries(obj)
    .map(
      ([k, v]) => `
      <div class="bar-row">
        <div class="lbl">${k}</div>
        <div><div class="bar" style="width:${(v / max) * 100}%;${
          colorFn ? `background:${colorFn(k)}` : ""
        }"></div></div>
        <div class="val">${fmt(v)}</div>
      </div>`,
    )
    .join("");
};

export async function render(root) {
  const m = await load("meta");
  const e = m.edges;
  const domains = await loadDomains();
  const title = (domains.find((d) => d.name === getDomain()) || {}).title || "Knowledge Base";
  const typeColor = makeTypeColor(Object.keys(m.nodes.by_type || {}));
  const axisColor = makeTypeColor(m.lenses.kept); // matches Claims + Lenses
  const grounded = m.identity !== "none";
  const corpus = m.corpus_papers && m.corpus_papers > m.papers
    ? ` of ${fmt(m.corpus_papers)} selected (${fmt(m.corpus_papers - m.papers)} without a readable full text yield no claims)`
    : "";
  const funnel = {
    "papers": m.papers,
    "claims extracted": m.claims,
    "candidate edges": e.input,
    [grounded ? "grounded edges (kept)" : "resolved edges (kept)"]: e.kept,
  };
  root.innerHTML = `
    <h1>${title}</h1>
    <p class="lead">A knowledge graph mined from ${fmt(m.papers)} papers${corpus}: every
      claim is extracted and adjudicated against the source text, every edge
      endpoint ${grounded
        ? "grounded to a reference entity"
        : "resolved to a curated canonical name — no external identifier covers this field, so nothing here is grounded outside the corpus"}.
      This is what the corpus currently supports — losses are shown, not hidden.</p>

    <div class="grid stat-row">
      <div class="card stat"><div class="n">${fmt(m.papers)}</div><div class="k">papers${m.corpus_papers && m.corpus_papers > m.papers ? ` <span class="dim">/ ${fmt(m.corpus_papers)}</span>` : ""}</div></div>
      <div class="card stat"><div class="n">${fmt(m.claims)}</div><div class="k">adjudicated claims</div></div>
      <div class="card stat"><div class="n">${fmt(e.kept)}</div><div class="k">${grounded ? "grounded" : "resolved"} edges</div></div>
      <div class="card stat"><div class="n">${fmt(m.nodes.total)}</div><div class="k">entities (nodes)</div></div>
      <div class="card stat"><div class="n">${fmt(m.reference_entities)}</div><div class="k">${grounded ? "reference canonicals" : "canonical names (ungrounded)"}</div></div>
    </div>

    <h2>From paper to ${grounded ? "grounded" : "resolved"} edge</h2>
    <div class="card">${bars(funnel)}</div>
    <p class="muted" style="font-size:13px;margin-top:10px">
      Of ${fmt(e.input)} candidate edges, ${fmt(e.kept)} are kept (both endpoints
      ${grounded ? "grounded" : "resolved to a canonical name"}), ${fmt(e.unresolved)} are unresolved (endpoint not yet mapped to a
      canonical — recoverable), and ${fmt(e.rejected)} rejected (endpoint absent
      from the claim's evidence). ${fmt(m.nodes.untyped)} of ${fmt(m.nodes.total)}
      nodes are still untyped.
    </p>

    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr));margin-top:8px">
      <div><h2>Entities by type</h2><div class="card">${bars(m.nodes.by_type, typeColor)}</div></div>
      <div><h2>Relations</h2><div class="card">${bars(m.relations)}</div></div>
      <div><h2>Layers</h2><div class="card">${bars(m.layers)}</div></div>
    </div>

    <h2>Lenses</h2>
    <p class="muted" style="font-size:14px">
      An axis earns a lens only if it covers enough of the corpus with a
      non-degenerate spread. ${fmt(m.lenses.kept.length)} earned a lens;
      ${fmt(m.lenses.rejected.length)} did not.
    </p>
    <div class="card">
      <p><strong>Earned:</strong> ${m.lenses.kept
        .map((x) => `<span class="chip"><span class="dot" style="background:${axisColor(x)}"></span>${x}</span>`)
        .join(" ")}</p>
      ${m.lenses.rejected.length ? `<p class="muted" style="font-size:13px"><strong>Rejected:</strong>
        ${m.lenses.rejected.map((r) => `${r.axis} <span class="mono">(${r.reason})</span>`).join(" · ")}</p>` : ""}
    </div>
    <p class="muted" style="font-size:13px;margin-top:20px">
      Explore the network in <a href="#/graph">Graph</a>, read the evidence in
      <a href="#/claims">Claims</a>, or see the lens distributions in
      <a href="#/lenses">Lenses</a>.
    </p>`;
}

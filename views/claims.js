import { load, fmt, makeTypeColor } from "../data.js";

const PAGE = 40; // claims per page (flat)
const GPAGE = 25; // groups per page (grouped)
const QUOTES_SHOWN = 3; // quotes visible before the "show more" toggle
const UNCLASSIFIED = "(unclassified)";
const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
// PDF-extracted quotes carry hard line breaks and soft hyphens — flatten them.
const norm = (s) => String(s ?? "").replace(/­/g, "").replace(/\s+/g, " ").trim();
// "perturbation_type" -> "Perturbation type"
const axisLabel = (a) => {
  const t = a.replace(/_/g, " ");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export async function render(root, params = {}) {
  const [claims, papersById, meta] = await Promise.all([load("claims"), load("papers"), load("meta")]);
  // The experiment triple's keys (system / perturbation / measurement) are the
  // cross-domain schema; the words shown are the domain's own (meta.experiment
  // .labels, e.g. "Model & method" for an ML corpus), with the glossary the
  // extractor read them by as a tooltip. Both fall back to the bare key.
  const expLabels = (meta && meta.experiment && meta.experiment.labels) || {};
  const expGloss = (meta && meta.experiment && meta.experiment.glossary) || {};
  const papers = [...new Set(claims.map((c) => c.paper))].sort();
  const verdicts = [...new Set(claims.map((c) => c.verdict).filter(Boolean))].sort();
  const axes = [...new Set(claims.flatMap((c) => Object.keys(c.buckets || {})))].sort();
  // One stable colour per lens axis — the same helper the graph uses for node
  // types, so an axis looks the same here, on Lenses and on Overview.
  const axisColor = makeTypeColor(axes);

  // A ?claim=<id> deep-link (from the graph) filters to that one claim and
  // highlights it; ?paper / ?q prefill the corresponding controls.
  const target = params.claim || "";
  let q = params.q || (target ? target : ""),
    paper = params.paper || "",
    verdict = "",
    group = "",
    page = 0;

  const groupOptions = [
    ["", "No grouping"],
    ["paper", "Paper"],
    ["verdict", "Verdict"],
    ...axes.map((a) => [`axis:${a}`, axisLabel(a)]),
  ];

  root.innerHTML = `
    <h1>Claims <span class="muted" style="font-size:16px">${fmt(claims.length)} across ${fmt(papers.length)} papers</span></h1>
    <div class="toolbar">
      <input type="search" id="q" placeholder="Search claim text, quote, paper title, or entity…" value="${esc(q)}" />
      <select id="paper"><option value="">All papers</option>${papers
        .map((p) => `<option${p === paper ? " selected" : ""}>${p}</option>`)
        .join("")}</select>
      <select id="verdict"><option value="">All verdicts</option>${verdicts
        .map((v) => `<option>${v}</option>`)
        .join("")}</select>
      <label class="group-by">Group by
        <select id="group">${groupOptions
          .map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`)
          .join("")}</select>
      </label>
      <span class="muted mono" id="count"></span>
    </div>
    <div id="list"></div>
    <div class="pager">
      <button class="btn" id="prev">← Prev</button>
      <span class="muted" id="pageinfo"></span>
      <button class="btn" id="next">Next →</button>
    </div>`;

  const list = root.querySelector("#list");
  const titleOf = (key) => (papersById[key] || {}).title || "";
  const filtered = () => {
    const needle = q.toLowerCase();
    return claims.filter((c) => {
      if (paper && c.paper !== paper) return false;
      if (verdict && c.verdict !== verdict) return false;
      if (!needle) return true;
      return (
        c.text.toLowerCase().includes(needle) ||
        c.id.toLowerCase().includes(needle) ||
        titleOf(c.paper).toLowerCase().includes(needle) ||
        c.quotes.some((qq) => (qq.quote || "").toLowerCase().includes(needle))
      );
    });
  };

  function sourceLine(c) {
    const p = papersById[c.paper];
    if (!p) return "";
    const href = p.doi ? `https://doi.org/${p.doi}` : p.url;
    const title = href
      ? `<a href="${esc(href)}" target="_blank" rel="noopener">${esc(p.title)}</a>`
      : esc(p.title);
    const where = [p.journal, p.year].filter(Boolean).join(", ");
    return `<div class="src">${title}${where ? `<span class="muted"> · ${esc(where)}</span>` : ""}${
      p.doi ? ` <span class="doi mono">${esc(p.doi)}</span>` : ""
    }</div>`;
  }

  function card(c) {
    // "albeck2013:findings:000" -> "findings · 000", shown next to the paper link
    const idx = c.id.startsWith(c.paper + ":") ? c.id.slice(c.paper.length + 1) : c.id;
    const lenses = Object.entries(c.buckets || {})
      .map(
        ([a, b]) =>
          `<span class="chip lens" style="--ax:${axisColor(a)}"><span class="dot"></span><span class="k">${esc(axisLabel(a))}</span>${esc(b)}</span>`,
      )
      .join("");
    const quotes = c.quotes.map(
      (qq, i) =>
        `<blockquote${i >= QUOTES_SHOWN ? ' class="extra"' : ""}><span class="qt">${esc(norm(qq.quote))}</span>${
          qq.page != null ? `<span class="pg mono">p.${qq.page}</span>` : ""
        }</blockquote>`,
    );
    const hidden = Math.max(0, c.quotes.length - QUOTES_SHOWN);
    const more = hidden
      ? `<button class="more" data-more="${hidden}">Show ${hidden} more quote${hidden > 1 ? "s" : ""}</button>`
      : "";
    const note = c.verdict_note
      ? `<div class="note v-${esc(c.verdict || "")}"><span class="k">Adjudicator</span><span>${esc(c.verdict_note)}</span></div>`
      : "";
    const exp = c.experiment;
    const experiment =
      exp && (exp.system || exp.perturbation || exp.measurement)
        ? `<dl class="exp">${["system", "perturbation", "measurement"]
            .filter((k) => exp[k])
            .map((k) => `<div><dt title="${esc(expGloss[k] || "")}">${esc(expLabels[k] || k)}</dt><dd>${esc(exp[k])}</dd></div>`)
            .join("")}</dl>`
        : "";
    return `<article class="claim${c.id === target ? " target" : ""}" id="claim-${esc(c.id)}">
      <div class="head">
        <a class="paper mono" href="#" data-paper="${esc(c.paper)}" title="Only this paper">${esc(c.paper)}</a>
        <span class="cid mono">${esc(idx.replace(":", " · "))}</span>
        ${lenses}
        ${c.quantitative ? `<span class="chip quant" title="Carries a number">quantitative</span>` : ""}
        ${c.verdict ? `<span class="chip verdict v-${esc(c.verdict)}">${esc(c.verdict)}</span>` : ""}
      </div>
      <p class="txt">${esc(c.text)}</p>
      ${sourceLine(c)}
      ${note}
      ${experiment}
      ${quotes.length ? `<div class="evidence">${quotes.join("")}${more}</div>` : ""}
    </article>`;
  }

  // Group key + display label for the active grouping mode.
  const groupKey = (c) => {
    if (group === "paper") return c.paper;
    if (group === "verdict") return c.verdict || UNCLASSIFIED;
    return (c.buckets || {})[group.slice(5)] || UNCLASSIFIED;
  };
  const groupLabel = (key) => {
    if (group === "paper" && papersById[key])
      return `<span class="mono">${esc(key)}</span> <span class="g-title">${esc(papersById[key].title)}</span>`;
    return `<span class="g-name">${esc(key)}</span>`;
  };

  let groups = new Map(); // group key -> rows, for lazy rendering on open

  function draw() {
    const rows = filtered();
    const count = root.querySelector("#count");
    const info = root.querySelector("#pageinfo");
    if (!group) {
      const pages = Math.max(1, Math.ceil(rows.length / PAGE));
      page = Math.min(page, pages - 1);
      count.textContent = `${fmt(rows.length)} match`;
      info.textContent = `page ${page + 1} / ${pages}`;
      root.querySelector("#prev").disabled = page === 0;
      root.querySelector("#next").disabled = page >= pages - 1;
      list.innerHTML =
        rows.slice(page * PAGE, page * PAGE + PAGE).map(card).join("") ||
        `<div class="empty">No claims match.</div>`;
      // scroll a deep-linked claim into view once
      if (target) {
        const el = root.querySelector(`#claim-${CSS.escape(target)}`);
        if (el) el.scrollIntoView({ block: "center" });
      }
      return;
    }
    groups = new Map();
    for (const c of rows) {
      const k = groupKey(c);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(c);
    }
    // largest groups first; the unclassified bucket always last
    const keys = [...groups.keys()].sort((a, b) => {
      if (a === UNCLASSIFIED) return 1;
      if (b === UNCLASSIFIED) return -1;
      return groups.get(b).length - groups.get(a).length || a.localeCompare(b);
    });
    const pages = Math.max(1, Math.ceil(keys.length / GPAGE));
    page = Math.min(page, pages - 1);
    count.textContent = `${fmt(rows.length)} match · ${fmt(keys.length)} group${keys.length === 1 ? "" : "s"}`;
    info.textContent = `page ${page + 1} / ${pages}`;
    root.querySelector("#prev").disabled = page === 0;
    root.querySelector("#next").disabled = page >= pages - 1;
    list.innerHTML =
      keys
        .slice(page * GPAGE, page * GPAGE + GPAGE)
        .map(
          (k) => `<details class="group" data-key="${esc(k)}">
            <summary>${groupLabel(k)}<span class="g-count">${fmt(groups.get(k).length)}</span></summary>
            <div class="g-body"></div>
          </details>`,
        )
        .join("") || `<div class="empty">No claims match.</div>`;
  }

  const reset = () => {
    page = 0;
    draw();
  };
  root.querySelector("#q").addEventListener("input", (e) => {
    q = e.target.value;
    reset();
  });
  root.querySelector("#paper").addEventListener("change", (e) => {
    paper = e.target.value;
    reset();
  });
  root.querySelector("#verdict").addEventListener("change", (e) => {
    verdict = e.target.value;
    reset();
  });
  root.querySelector("#group").addEventListener("change", (e) => {
    group = e.target.value;
    reset();
  });
  // A group's cards are rendered the first time it is opened, so grouping by
  // paper does not put every claim in the DOM at once.
  list.addEventListener("toggle", (e) => {
    const d = e.target;
    if (!d.classList.contains("group") || !d.open) return;
    const body = d.querySelector(".g-body");
    if (body.childElementCount) return;
    body.innerHTML = (groups.get(d.dataset.key) || []).map(card).join("");
  }, true);
  // Delegated: a paper link filters to that paper; "show more" reveals the
  // remaining quotes of one card.
  list.addEventListener("click", (e) => {
    const link = e.target.closest("a.paper");
    if (link) {
      e.preventDefault();
      paper = link.dataset.paper;
      root.querySelector("#paper").value = paper;
      reset();
      window.scrollTo(0, 0);
      return;
    }
    const more = e.target.closest("button.more");
    if (more) {
      const open = more.closest(".claim").classList.toggle("expanded");
      const n = more.dataset.more;
      more.textContent = open ? "Show fewer quotes" : `Show ${n} more quote${n > 1 ? "s" : ""}`;
    }
  });
  root.querySelector("#prev").addEventListener("click", () => {
    page--;
    draw();
    window.scrollTo(0, 0);
  });
  root.querySelector("#next").addEventListener("click", () => {
    page++;
    draw();
    window.scrollTo(0, 0);
  });
  draw();
}

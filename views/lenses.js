import { load, fmt, makeTypeColor } from "../data.js";

const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const heatColor = (frac) => {
  // low -> panel-ish, high -> accent. HSL ramp.
  const l = 62 - frac * 34;
  return `hsl(${222 - frac * 60}, 70%, ${l}%)`;
};

export async function render(root) {
  const lenses = await load("lenses");
  const claims = await load("claims");
  const byId = new Map(claims.map((c) => [c.id, c]));
  // same axis -> same colour as the lens chips on Claims and Overview
  const axisColor = makeTypeColor(lenses.kept.map((l) => l.axis));

  const keptHtml = lenses.kept
    .map((lens) => {
      const entries = Object.entries(lens.buckets);
      const total = entries.reduce((s, [, ids]) => s + ids.length, 0) || 1;
      const rows = entries
        .map(([b, ids]) => {
          const frac = ids.length / total;
          const sample = ids
            .slice(0, 3)
            .map((id) => byId.get(id)?.text?.slice(0, 90) || id)
            .map((t) => `<div class="quote">${esc(t)}…</div>`)
            .join("");
          return `
          <tr>
            <td style="width:190px"><strong>${esc(b)}</strong></td>
            <td style="width:90px"><span class="heat" style="background:${heatColor(frac)}">${fmt(ids.length)}</span></td>
            <td style="width:70px" class="muted">${(frac * 100).toFixed(0)}%</td>
            <td>${sample}</td>
          </tr>`;
        })
        .join("");
      return `
        <h2><span class="axis-dot" style="background:${axisColor(lens.axis)}"></span>${esc(lens.axis)} <span class="muted" style="font-size:14px">· ${fmt(total)} classified · ${esc(lens.mode || "")}</span></h2>
        <div class="card" style="padding:0;overflow:hidden">
          <table>
            <thead><tr><th>bucket</th><th>claims</th><th>share</th><th>sample</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`;
    })
    .join("");

  const rejected = lenses.rejected
    .map(
      (r) =>
        `<tr><td><strong>${esc(r.axis)}</strong></td><td class="mono muted">${esc(r.reason)}</td></tr>`,
    )
    .join("");

  root.innerHTML = `
    <h1>Lenses</h1>
    <p class="lead">A lens is an axis that partitions the corpus meaningfully — it
      must cover enough claims with a non-degenerate spread to earn a view.
      ${fmt(lenses.kept.length)} ${lenses.kept.length === 1 ? "axis" : "axes"} survived that gate;
      ${lenses.rejected.length ? `${fmt(lenses.rejected.length)} ${lenses.rejected.length === 1 ? "was" : "were"} rejected and ${lenses.rejected.length === 1 ? "is" : "are"} shown for honesty.` : "none was rejected."}</p>
    ${keptHtml}
    ${lenses.rejected.length ? `<h2>Rejected axes</h2>
    <div class="card" style="padding:0;overflow:hidden">
      <table><thead><tr><th>axis</th><th>reason</th></tr></thead><tbody>${rejected}</tbody></table>
    </div>` : ""}`;
}

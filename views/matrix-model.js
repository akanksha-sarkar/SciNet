// Pure model for the matrix view — no DOM, no fetch — so it can be unit
// tested with node:test (tools/tests/matrix-model.test.mjs).
//
// The matrix reads systems (rows) against property nodes (columns). What a
// "system" is and which node type and relation make a column and a stated
// cell are DOMAIN DATA: they arrive in `config` from the domain's
// `[systems.matrix]` table via the systems bundle. No name from any one
// domain appears here.

// A cell is stronger evidence when the relation itself says so, so a stated
// edge counts double a mere co-mention.
export const cellWeight = (cell) =>
  cell ? cell.stated.length * 2 + cell.mentioned.length : 0;

const emptyCell = () => ({ stated: [], mentioned: [] });

// The synthetic last row: the nodes of the configured types that no declared
// system matched. It carries no claims — a leftover node is exactly the case
// where nothing tells us which system a claim is about — so it shows stated
// edges only, which is what makes it an honest remainder rather than noise.
export const UNASSIGNED_ROW = "_unassigned";

/**
 * buildMatrix({systems, nodes, edges, claims, config}) -> {rows, cols, cells}
 *
 * rows  the declared systems in file order, plus `_unassigned` last when the
 *       unclaimed nodes have at least one qualifying edge.
 * cols  every node of `config.property_type`, by cell weight desc then id.
 * cells cells[rowId][colId] = {stated, mentioned}, both lists of edges:
 *       `stated` are `config.relation` edges from one of the row's node_ids
 *       to the column node; `mentioned` are any other edges of the row's own
 *       claims that touch the column node.
 */
export function buildMatrix({ systems = [], nodes = [], edges = [], claims = [], config = {} }) {
  const propertyType = config.property_type;
  const relation = config.relation;
  const colNodes = nodes.filter((n) => n.type === propertyType);
  const colIds = new Set(colNodes.map((n) => n.id));

  const claimed = new Set();
  for (const s of systems) for (const id of s.node_ids || []) claimed.add(id);
  // Recomputed from `nodes` rather than read from the bundle's
  // `unassigned.nodes` on purpose: the model's inputs are the graph and the
  // systems, so it stays testable and cannot disagree with the node list the
  // matrix is actually drawn from.
  // Only the node types the domain declared as systems can be "unassigned";
  // a domain that declares none leaves every unclaimed node eligible.
  const rowTypes = Array.isArray(config.node_types) ? new Set(config.node_types) : null;
  const leftover = nodes
    .filter((n) => !claimed.has(n.id) && (!rowTypes || rowTypes.has(n.type)))
    .map((n) => n.id);

  const rows = systems.map((s) => ({
    id: s.id,
    label: s.label,
    family: s.family,
    attributes: s.attributes || {},
    node_ids: s.node_ids || [],
    claim_ids: s.claim_ids || [],
    papers: s.papers,
  }));
  rows.push({
    id: UNASSIGNED_ROW,
    label: "unassigned",
    family: "",
    attributes: {},
    node_ids: leftover,
    claim_ids: [],
    papers: 0,
  });

  // The matrix counts only evidence the view can show: an edge whose claim is
  // not in the bundle would be a cell nobody can open. An empty `claims` list
  // (the unit tests, a bundle read without it) disables the filter.
  const known = claims.length ? new Set(claims.map((c) => c.id)) : null;
  const shown = (e) => !known || known.has(e.claim_id);

  const cells = {};
  for (const row of rows) {
    const rowNodes = new Set(row.node_ids);
    const rowClaims = new Set(row.claim_ids);
    const cell = {};
    for (const c of colNodes) cell[c.id] = emptyCell();
    for (const e of edges) {
      if (!shown(e)) continue;
      const statedCol =
        e.relation === relation && rowNodes.has(e.source) && colIds.has(e.target)
          ? e.target
          : null;
      if (statedCol) cell[statedCol].stated.push(e);
      if (!rowClaims.has(e.claim_id)) continue;
      // An edge between two columns ("superconductivity coexists_with metallic
      // state") is evidence about BOTH properties, so it is a mention on each
      // end it touches — a self-loop counts once, and an end that already
      // holds it as a stated edge does not double-count it.
      for (const end of new Set([e.source, e.target])) {
        if (colIds.has(end) && end !== statedCol) cell[end].mentioned.push(e);
      }
    }
    cells[row.id] = cell;
  }

  // The unassigned row earns its place only when it has something to show.
  const last = rows[rows.length - 1];
  if (!colNodes.some((c) => cellWeight(cells[last.id][c.id]))) {
    rows.pop();
    delete cells[last.id];
  }

  const weightOf = (colId) =>
    rows.reduce((sum, r) => sum + cellWeight(cells[r.id][colId]), 0);
  const cols = colNodes
    .map((n) => ({ id: n.id, label: n.label || n.id, weight: weightOf(n.id), degree: n.degree || 0 }))
    .sort((a, b) => b.weight - a.weight || a.id.localeCompare(b.id));

  return { rows, cols, cells };
}

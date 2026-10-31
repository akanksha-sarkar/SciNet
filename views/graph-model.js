// Pure helpers for the graph view — no DOM, no fetch — so they can be unit
// tested in isolation.

// Candidate "min degree" cuts for the overview, in the order the picker tries them.
export const DEGREE_STEPS = [1, 2, 3, 4, 5, 8, 13];

// Default size budget for the overview: the smallest degree cut that leaves at
// most this many nodes on the canvas is the one a fresh visit gets.
export const OVERVIEW_TARGET = 200;

// Fold raw edges (one per claim) into one edge per (subject, relation, object)
// triple. The merged edge carries every claim id behind it and a weight; the
// first claim stays in `claim_id` so existing single-claim consumers keep
// working. Order of first appearance is preserved.
export function mergeEdges(edges) {
  const byKey = new Map();
  for (const e of edges) {
    const key = `${e.subject} ${e.relation} ${e.object}`;
    const hit = byKey.get(key);
    if (hit) {
      hit.claim_ids.push(e.claim_id);
      hit.weight += 1;
    } else {
      byKey.set(key, { ...e, claim_ids: [e.claim_id], weight: 1 });
    }
  }
  return [...byKey.values()];
}

// Number of nodes that keep at least one edge once every node with degree < k
// is removed. `degree` is the node's full-graph degree as emitted by the build.
export function nodesAtDegree(nodes, edges, k) {
  const deg = new Map(nodes.map((n) => [n.id, n.degree || 0]));
  const present = new Set();
  for (const e of edges) {
    if ((deg.get(e.source) || 0) >= k && (deg.get(e.target) || 0) >= k) {
      present.add(e.source);
      present.add(e.target);
    }
  }
  return present.size;
}

// Smallest degree step whose pruned view has at most `target` nodes; the
// largest step if none does. Small graphs therefore get 1 (nothing hidden).
export function pickMinDegree(nodes, edges, target = OVERVIEW_TARGET) {
  for (const k of DEGREE_STEPS) {
    if (nodesAtDegree(nodes, edges, k) <= target) return k;
  }
  return DEGREE_STEPS[DEGREE_STEPS.length - 1];
}

// Column order for the graph's entity-type layout. `declared` (a domain's
// meta.graph.column_order, or undefined) wins for the types it names, in
// its own order, skipping any it names that aren't actually present; every
// other present type follows in the existing degree-then-name order. With
// no declaration this reproduces today's order exactly.
export function orderTypes(types, typeDegree, declared) {
  const present = new Set(types);
  const byDegreeThenName = [...types].sort(
    (a, b) => (typeDegree[b] || 0) - (typeDegree[a] || 0) || a.localeCompare(b),
  );
  if (!Array.isArray(declared)) return byDegreeThenName;
  const first = declared.filter((t) => present.has(t));
  const firstSet = new Set(first);
  return [...first, ...byDegreeThenName.filter((t) => !firstSet.has(t))];
}

// Tokens a shared-vocabulary test can compare: lowercase alphanumeric runs.
// "MoSe2/WS2 heterobilayers" -> ["mose2", "ws2", "heterobilayers"].
function tokens(text) {
  return String(text || "").toLowerCase().match(/[a-z0-9]+/g) || [];
}

// Does a quantity label talk about the same thing as one of the two nodes?
// A token of 4+ characters may match loosely (substring, so "exciton" reaches
// "excitons"); a 2-3 character token — "Tc", "gap" — must match a whole token
// exactly, because a short fragment matches almost anything. One-character
// tokens never count.
function sharesVocabulary(quantity, nodeTokens) {
  const qs = tokens(quantity);
  for (const q of qs) {
    if (q.length < 2) continue;
    for (const n of nodeTokens) {
      if (q === n) return true;
      if (q.length >= 4 && n.length >= 4 && (n.includes(q) || q.includes(n))) return true;
    }
  }
  return false;
}

// The one number on a claim that is EVIDENCE FOR this relation, or null.
// A claim commonly carries several unrelated numbers, so taking numbers[0]
// labels the relation with whatever the paper happened to state first — a
// "hosts → hybridised exciton states" edge suffixed with a PL redshift. Only a
// number whose quantity label shares vocabulary with the subject or the object
// is allowed to speak for the edge; when none does, the edge shows no value.
export function pickEvidenceNumber(numbers, subjectId, objectId) {
  const nodeTokens = [...tokens(subjectId), ...tokens(objectId)].filter((t) => t.length >= 2);
  for (const number of numbers || []) {
    if (!number || (number.value === null || number.value === undefined || number.value === "")) continue;
    if (sharesVocabulary(number.quantity, nodeTokens)) return number;
  }
  return null;
}

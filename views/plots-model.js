// Pure helpers for the plots view — no DOM, no fetch — so they can be unit
// tested with node:test (tools/tests/plots-model.test.mjs).

// The points one declared plot draws, from the typed rows of quantities.json,
// plus the counts of everything it refused — a plot that silently drops rows
// is a plot that lies about its own coverage.
//
// Returns {points, excluded, unit_mismatch}.
//
// A point needs both coordinates on the SAME claim: that is the only pairing a
// corpus of independent papers licenses. Three sources of x, in order of how
// close each is to what the paper actually said:
//   "claim"        a number the claim itself reports  (filled)
//   "claim_system" read out of the claim's own system string (ring)
//   "system"       the stack's declared attribute     (thin hollow)
// A y row the parser could not read is dropped rather than plotted at 0, and
// a row whose unit is not the axis unit is counted, never rescaled by guess.
//
// `sections` and `exclude_pattern` are the plot's declared evidence filter,
// matched against the claim's section and its experiment strings.
export function pointsFor(plot, rows, systems = {}, claims = {}, kinds = []) {
  const unitOf = new Map((kinds || []).map((k) => [k.kind, k.unit ?? ""]));
  const wrongUnit = (row, kind) =>
    row && unitOf.has(kind) && (row.unit ?? "") !== unitOf.get(kind);
  const kept = new Map();
  let unit_mismatch = 0;
  for (const r of rows || []) {
    if (r.value === null || r.value === undefined) continue;
    if (r.kind !== plot.x && r.kind !== plot.y) continue;
    if (!kept.has(r.claim_id)) kept.set(r.claim_id, []);
    kept.get(r.claim_id).push(r);
  }
  const exclude = plot.exclude_pattern ? new RegExp(plot.exclude_pattern, "i") : null;
  const allowed = (claim_id) => {
    const claim = claims[claim_id];
    if (!claim) return !plot.sections && !exclude;
    if (plot.sections && !plot.sections.includes(claim.section)) return false;
    if (exclude) {
      const e = claim.experiment || {};
      for (const field of ["system", "perturbation", "measurement"])
        if (e[field] && exclude.test(e[field])) return false;
    }
    return true;
  };

  const points = [];
  let excluded = 0;
  for (const [claim_id, group] of kept) {
    const measured = group.find((r) => r.kind === plot.x && r.source !== "system");
    const derived = group.find((r) => r.kind === plot.x && r.source === "system");
    for (const y of group.filter((r) => r.kind === plot.y)) {
      if (!allowed(claim_id)) {
        excluded += 1;
        continue;
      }
      const system = systems[y.system_id] || null;
      let x = null;
      let x_from = null;
      let x_row = null;
      if (measured) {
        [x, x_from, x_row] = [measured.value, "claim", measured];
      } else if (derived) {
        [x, x_from, x_row] = [derived.value, "claim_system", derived];
      } else if (plot.x_system_attribute && system) {
        const attr = (system.attributes || {})[plot.x_system_attribute];
        if (typeof attr === "number" && isFinite(attr)) [x, x_from] = [attr, "system"];
      }
      if (x === null) continue;
      if (wrongUnit(y, plot.y) || wrongUnit(x_row, plot.x)) {
        unit_mismatch += 1;
        continue;
      }
      points.push({
        claim_id,
        system_id: y.system_id ?? null,
        family: system ? system.family : null,
        x,
        y: y.value,
        x_from,
        bound: y.bound ?? null,
        row: y,
        x_row,
      });
    }
  }
  return { points, excluded, unit_mismatch };
}

// `count` or so round tick values covering [min, max]. The step is 1, 2, 2.5
// or 5 times a power of ten, so an axis reads 0.5 / 1 / 1.5 rather than
// 0.4266 / 0.8532. A degenerate range still gets a readable axis.
export function niceTicks(min, max, count = 5) {
  if (!isFinite(min) || !isFinite(max)) return [0];
  if (max <= min) max = min + (Math.abs(min) || 1);
  const rough = (max - min) / Math.max(1, count - 1);
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  // Accumulate from `lo` in whole steps and re-round each value: adding a
  // float step repeatedly otherwise prints 0.30000000000000004 on an axis.
  for (let i = 0; lo + i * step <= hi + step * 1e-9 && i < 200; i++) {
    ticks.push(Number((lo + i * step).toPrecision(12)));
  }
  return ticks;
}

// A tick's label: exactly the decimals the step itself needs, so a 2.5 step
// prints 2.5 and 7.5 rather than rounding both to 3 and 8.
export function tickLabel(value, step) {
  const s = String(Number(Math.abs(step || 1).toPrecision(12)));
  let decimals;
  if (s.includes("e")) {
    decimals = Math.max(0, -Math.floor(Math.log10(Math.abs(step || 1))));
  } else {
    const dot = s.indexOf(".");
    decimals = dot < 0 ? 0 : s.length - dot - 1;
  }
  return value.toFixed(Math.min(6, decimals));
}

// Log-y: which points a log axis can draw. A y that is zero, negative or not
// finite has no place on it, so it is left off and counted (the caller says
// how many), never clamped to the axis floor. `keep` holds indices into
// `points`, so a drawn mark still names the same point as the table row.
export function logYSplit(points) {
  const keep = [];
  (points || []).forEach((p, i) => {
    if (typeof p.y === "number" && isFinite(p.y) && p.y > 0) keep.push(i);
  });
  return { keep, skipped: (points || []).length - keep.length };
}

// Whole-decade ticks covering [min, max] (both > 0). One value gets two
// decades; a range wider than 7 decades steps by 2, 3, ... decades so the
// axis keeps at most 8 ticks.
export function logTicks(min, max) {
  if (!(min > 0) || !(max > 0) || !isFinite(min) || !isFinite(max)) return [1];
  const lo = Math.floor(Math.log10(min) + 1e-9);
  let hi = Math.ceil(Math.log10(max) - 1e-9);
  if (hi <= lo) hi = lo + 1;
  const step = Math.ceil((hi - lo) / 7);
  const ticks = [];
  for (let e = lo; ; e += step) {
    ticks.push(Number(`1e${e}`));
    if (e >= hi) break;
  }
  return ticks;
}

// A decade tick's label: 0.001 .. 1000 as plain numbers, beyond that 1e-7.
export function logTickLabel(value) {
  const e = Math.round(Math.log10(value));
  return e >= -3 && e <= 3 ? String(value) : `1e${e}`;
}

"""M1 — candidate generation + temporal labels.

A candidate is an ordered pair (A, C), A != C, such that some intermediate B has
A->B and B->C in G_t, and A->C is NOT already an edge in G_t (open 2-path).
Label = 1 iff the pair first appears as a KG edge with paper-year > t.

Usage:  python3 build_dataset.py --t 2012
Writes: candidates/<t>.jsonl   {A, C, label, bridges:[B...]}
"""
from __future__ import annotations

import argparse
import json
import os

import common


def generate_candidates(g: common.FrozenGraph):
    rows = []
    n_pos = 0
    for a, cs in g.out.items():
        # bridge nodes reachable from A that themselves point somewhere
        bridges_by_c: dict[str, list[str]] = {}
        for b in cs:
            for c in g.out.get(b, ()):
                if c == a or c in g.out.get(a, ()):  # self, or already an edge in G_t
                    continue
                bridges_by_c.setdefault(c, []).append(b)
        for c, bridges in bridges_by_c.items():
            fy = g.first_year.get((a, c))
            label = 1 if (fy is not None and fy > g.t) else 0
            n_pos += label
            rows.append({"A": a, "C": c, "label": label, "bridges": sorted(set(bridges))})
    return rows, n_pos


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--t", type=int, default=2012)
    args = ap.parse_args()

    edges = common.load_influence_edges()
    g = common.freeze(edges, args.t)
    rows, n_pos = generate_candidates(g)

    outdir = os.path.join(common.HERE, "candidates")
    os.makedirs(outdir, exist_ok=True)
    path = os.path.join(outdir, f"{args.t}.jsonl")
    with open(path, "w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")

    pre_edges = sum(len(v) for v in g.out.values())
    neg = len(rows) - n_pos
    print(f"t={args.t}")
    print(f"  G_t: {pre_edges} influence edges, {len(g.node_papers)} nodes, {g.n_papers} papers")
    print(f"  candidates: {len(rows)}   positives: {n_pos}   negatives: {neg}   neg:pos={neg / n_pos:.1f}")
    print(f"  wrote {path}")


if __name__ == "__main__":
    main()

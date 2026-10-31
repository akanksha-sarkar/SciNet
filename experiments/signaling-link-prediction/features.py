"""M2 — featurize candidates (Luo et al. 2018, Table 3: influence-graph + corpus
blocks; citation-graph block deferred to v2). Pure stdlib.

Path features use the shortest A->C path in G_t with the whole bridge set removed,
so they measure connectivity BEYOND the obvious 2-path (see PLAN.md §3). Aggregates
over bridge nodes / in-between nodes / path edges use the mean (0 when the set is
empty, e.g. no path avoiding the bridges).

Usage:  python3 features.py --t 2012
Writes: features/<t>.jsonl   {A, C, label, feats:[...]}
        features/feature_names.json
"""
from __future__ import annotations

import argparse
import json
import os
from collections import deque

import common

FEATURE_NAMES = [
    # influence-graph block
    "A_outdeg", "A_indeg", "C_outdeg", "C_indeg",
    "inbetween_outdeg_mean", "inbetween_indeg_mean",
    "shortest_path_length", "shortest_path_count",
    "inbetween_avg_idf", "rinbetween_avg_seen",
    # corpus block
    "A_idf", "B_idf_mean", "C_idf",
    "r1_seen_mean", "r2_seen_mean",
]


def _bfs_counts(adj, src, blocked):
    """BFS over directed adj from src, skipping `blocked` nodes.
    Returns dist{} and npaths{} (number of shortest paths src->node)."""
    dist = {src: 0}
    npaths = {src: 1}
    q = deque([src])
    while q:
        u = q.popleft()
        for v in adj.get(u, ()):  # adj[u] = successors
            if v in blocked:
                continue
            if v not in dist:
                dist[v] = dist[u] + 1
                npaths[v] = npaths[u]
                q.append(v)
            elif dist[v] == dist[u] + 1:
                npaths[v] += npaths[u]
    return dist, npaths


def path_features(g: common.FrozenGraph, rev: dict, a: str, c: str, bridges: set[str]):
    """Shortest a->c path in G_t avoiding `bridges`. Returns
    (length, count, inbetween_nodes, path_edges)."""
    blocked = set(bridges)
    distA, npathsA = _bfs_counts(g.out, a, blocked)
    if c not in distA:
        return 0, 0, set(), []
    L = distA[c]
    distC, _ = _bfs_counts(rev, c, blocked)  # distance TO c over reverse graph
    on_path = {v for v in distA if v in distC and distA[v] + distC[v] == L}
    inbetween = on_path - {a, c}
    # edges (u,v) lying on a shortest path
    path_edges = []
    for u in on_path:
        for v in g.out.get(u, ()):
            if v in on_path and distA.get(u, -9) + 1 + distC.get(v, 9) == L:
                path_edges.append((u, v))
    return L, npathsA[c], inbetween, path_edges


def featurize(g: common.FrozenGraph, rev: dict, row: dict) -> list[float]:
    a, c = row["A"], row["C"]
    bridges = set(row["bridges"])

    L, count, inbetween, path_edges = path_features(g, rev, a, c, bridges)

    def mean(xs):
        xs = list(xs)
        return sum(xs) / len(xs) if xs else 0.0

    ib_out = mean(len(g.out.get(n, ())) for n in inbetween)
    ib_in = mean(len(g.inn.get(n, ())) for n in inbetween)
    ib_idf = mean(g.idf(n) for n in inbetween)
    r_avg_seen = mean(g.seen.get((u, v), 0) for (u, v) in path_edges)

    b_idf = mean(g.idf(b) for b in bridges)
    r1_seen = mean(g.seen.get((a, b), 0) for b in bridges)   # A->B
    r2_seen = mean(g.seen.get((b, c), 0) for b in bridges)   # B->C

    return [
        float(len(g.out.get(a, ()))), float(len(g.inn.get(a, ()))),
        float(len(g.out.get(c, ()))), float(len(g.inn.get(c, ()))),
        ib_out, ib_in,
        float(L), float(count),
        ib_idf, r_avg_seen,
        g.idf(a), b_idf, g.idf(c),
        r1_seen, r2_seen,
    ]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--t", type=int, default=2012)
    args = ap.parse_args()

    edges = common.load_influence_edges()
    g = common.freeze(edges, args.t)
    rev = {}  # reverse adjacency (successors over reversed edges = predecessors)
    for u, vs in g.out.items():
        for v in vs:
            rev.setdefault(v, set()).add(u)

    cand_path = os.path.join(common.HERE, "candidates", f"{args.t}.jsonl")
    rows = [json.loads(l) for l in open(cand_path)]

    outdir = os.path.join(common.HERE, "features")
    os.makedirs(outdir, exist_ok=True)
    json.dump(FEATURE_NAMES, open(os.path.join(outdir, "feature_names.json"), "w"), indent=2)

    out_path = os.path.join(outdir, f"{args.t}.jsonl")
    n_pos = 0
    with open(out_path, "w") as f:
        for r in rows:
            feats = featurize(g, rev, r)
            n_pos += r["label"]
            f.write(json.dumps({"A": r["A"], "C": r["C"], "label": r["label"], "feats": feats}) + "\n")

    # quick sanity summary
    import statistics
    all_feats = [json.loads(l)["feats"] for l in open(out_path)]
    print(f"t={args.t}: {len(all_feats)} rows x {len(FEATURE_NAMES)} feats, {n_pos} positives")
    print(f"  wrote {out_path}")
    for i, name in enumerate(FEATURE_NAMES):
        col = [fr[i] for fr in all_feats]
        assert all(x == x for x in col), f"NaN in {name}"  # x==x fails for NaN
        print(f"  {name:24s} min={min(col):8.3f} mean={statistics.mean(col):8.3f} max={max(col):8.3f}")


if __name__ == "__main__":
    main()

"""Unsupervised, parameter-free structural link-prediction scores on the frozen
influence graph — the CS6850 angle. No training, so immune to the ~57-positive
label scarcity that limits the supervised classifiers (backtest.py).

Ladder (Liben-Nowell & Kleinberg 2007, adapted to the directed 2-path setting):
  common_neighbors, jaccard, adamic_adar, resource_alloc, pref_attach, katz
Proposal (expansion / conductance):
  cohesion   = sum_B  cohesion(B)/log(1+deg B),  cohesion(B)=|N(B)∩(N(A)∪N(C))|/|N(B)|
  conductance= 1 - phi(S),  S = {A,C} ∪ bridges   (phi = cut/volume)

Each score ranks the SAME candidate set used by the supervised pipeline, evaluated
on the full set (no labels used to score) with MAP and P@k, plus a bootstrap std.

Usage:  <venv>/bin/python structural_scores.py --t 2010
Writes: results/structural_<t>.json
"""
from __future__ import annotations

import argparse
import json
import math
import os

import numpy as np
from sklearn.metrics import average_precision_score

import common


def load_candidates(t: int):
    rows = [json.loads(l) for l in open(os.path.join(common.HERE, "candidates", f"{t}.jsonl"))]
    return rows


def build_neighbors(g: common.FrozenGraph):
    nodes = set(g.out) | set(g.inn)
    N = {x: (g.out.get(x, set()) | g.inn.get(x, set())) for x in nodes}
    deg = {x: len(N[x]) for x in nodes}
    return N, deg


# ---- score functions: each takes (g, N, deg, A, C, bridges) -> float ----

def s_common_neighbors(g, N, deg, A, C, B):
    return float(len(B))


def s_jaccard(g, N, deg, A, C, B):
    union = len(g.out.get(A, set()) | g.inn.get(C, set()))
    return len(B) / union if union else 0.0


def s_adamic_adar(g, N, deg, A, C, B):
    return sum(1.0 / math.log(1 + deg[b]) for b in B if deg[b] > 0)


def s_resource_alloc(g, N, deg, A, C, B):
    return sum(1.0 / deg[b] for b in B if deg[b] > 0)


def s_pref_attach(g, N, deg, A, C, B):
    return float(len(g.out.get(A, set())) * len(g.inn.get(C, set())))


def s_cohesion(g, N, deg, A, C, B):
    """Proposal: hub-discounted bridges weighted by how non-expansive (locally
    contained) each bridge is."""
    local = N.get(A, set()) | N.get(C, set())
    tot = 0.0
    for b in B:
        nb = N[b]
        if not nb:
            continue
        coh = len(nb & local) / len(nb)         # 1 - local expansion of b
        tot += coh / math.log(1 + deg[b])
    return tot


def s_conductance(g, N, deg, A, C, B):
    """Proposal variant: 1 - conductance of the witness set S={A,C}∪bridges."""
    S = {A, C} | set(B)
    vol = sum(deg[x] for x in S)
    if vol == 0:
        return 0.0
    cut = 0
    for x in S:
        cut += sum(1 for y in N[x] if y not in S)
    phi = cut / vol
    return (1.0 - phi) * len(B)                  # weight by path evidence


SCORERS = {
    "common_neighbors": s_common_neighbors,
    "jaccard": s_jaccard,
    "adamic_adar": s_adamic_adar,
    "resource_alloc": s_resource_alloc,
    "pref_attach": s_pref_attach,
    "cohesion*": s_cohesion,
    "conductance*": s_conductance,
}


def katz_scores(g, rows, beta=0.05, L=4):
    """Katz over the directed influence graph via truncated matrix powers."""
    nodes = sorted(set(g.out) | set(g.inn))
    idx = {n: i for i, n in enumerate(nodes)}
    n = len(nodes)
    M = np.zeros((n, n), dtype=np.float64)
    for a, cs in g.out.items():
        for c in cs:
            M[idx[a], idx[c]] = 1.0
    K = np.zeros((n, n), dtype=np.float64)
    P = M.copy()
    for ell in range(1, L + 1):
        K += (beta ** ell) * P
        if ell < L:
            P = P @ M
    return [float(K[idx[r["A"]], idx[r["C"]]]) for r in rows]


def pk(y, s, k):
    order = np.argsort(-s, kind="stable")[:k]
    return float(y[order].sum()) / k


def evaluate(y, s, boot=300, seed=0):
    rng = np.random.default_rng(seed)
    base = {"MAP": average_precision_score(y, s), "P@10": pk(y, s, 10),
            "P@20": pk(y, s, 20), "P@50": pk(y, s, 50)}
    # bootstrap over candidates for std
    stats = {k: [] for k in base}
    n = len(y)
    for _ in range(boot):
        ix = rng.integers(0, n, n)
        yb, sb = y[ix], s[ix]
        if yb.sum() == 0:
            continue
        stats["MAP"].append(average_precision_score(yb, sb))
        stats["P@10"].append(pk(yb, sb, 10)); stats["P@20"].append(pk(yb, sb, 20))
        stats["P@50"].append(pk(yb, sb, 50))
    return {k: {"value": base[k], "boot_std": float(np.std(stats[k]))} for k in base}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--t", type=int, default=2010)
    args = ap.parse_args()

    edges = common.load_influence_edges()
    g = common.freeze(edges, args.t)
    N, deg = build_neighbors(g)
    rows = load_candidates(args.t)
    y = np.array([r["label"] for r in rows], int)

    results = {"t": args.t, "n_candidates": len(rows), "n_positives": int(y.sum()),
               "positive_rate": float(y.mean()), "scores": {}}

    cols = {}
    for name, fn in SCORERS.items():
        s = np.array([fn(g, N, deg, r["A"], r["C"], set(r["bridges"])) for r in rows], float)
        cols[name] = s
    cols["katz"] = np.array(katz_scores(g, rows), float)

    for name, s in cols.items():
        results["scores"][name] = evaluate(y, s)

    outdir = os.path.join(common.HERE, "results")
    os.makedirs(outdir, exist_ok=True)
    path = os.path.join(outdir, f"structural_{args.t}.json")
    json.dump(results, open(path, "w"), indent=2)

    print(f"t={args.t}  {len(rows)} candidates / {int(y.sum())} positives "
          f"(rate {y.mean():.4f})  [* = proposal]")
    print(f"{'score':18s} {'MAP':>16} {'P@10':>14} {'P@20':>14} {'P@50':>14}")
    order = ["common_neighbors", "jaccard", "adamic_adar", "resource_alloc",
             "katz", "pref_attach", "cohesion*", "conductance*"]
    for name in order:
        r = results["scores"][name]
        def c(k): return f"{r[k]['value']:.3f}±{r[k]['boot_std']:.3f}"
        print(f"{name:18s} {c('MAP'):>16} {c('P@10'):>14} {c('P@20'):>14} {c('P@50'):>14}")
    print(f"wrote {path}")


if __name__ == "__main__":
    main()

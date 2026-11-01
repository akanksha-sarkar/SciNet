"""Run the ERRW recreation on the signaling KG.

Stages (each writes results/<stage>.json; later stages read earlier ones):
  table1  substrate stats (N, <k>, C, L) + empirical Heaps' beta  (paper Table 1)
  sweep   beta(dw) on each substrate at the empirical length T    (paper Fig. 2b analogue)
  fit     dw* matching each empirical beta, re-verified at dw*    (paper Fig. 3c / Table 1)

beta is fitted over two windows (WINDOWS). "full" is the paper's whole-curve fit. "early"
stops at t = 1000, before the walk saturates the ~2k-node network (the paper's networks
are ~50x larger); on the full range no dw > 0 can reach the empirical beta, see README.
  corr    f(dt), M_l, H(n) for data and ERRW vs glob/loc nulls    (paper Fig. 4)
  sw      paper's own small-world sweep, as a simulator sanity check (paper Fig. 2b)

Usage:  python3 run.py [stage ...]      (no args = all stages)
"""
from __future__ import annotations

import argparse
import json
import os
from concurrent.futures import ProcessPoolExecutor

import networkx as nx
import numpy as np

import common
import correlations as cr
import errw

SEQ_MODES = ["distinct", "mentions"]
DW_GRID = [0.0] + np.geomspace(1e-2, 1e3, 31).round(6).tolist()
REPS = 50
WINDOWS = {"full": (10, None), "early": (10, 1000)}


def betas(mean: np.ndarray, curves: np.ndarray) -> dict:
    """{window: {beta of the mean curve, sd of per-walk betas}}."""
    out = {}
    for w, (lo, hi) in WINDOWS.items():
        out[w] = {"beta": errw.fit_beta(mean, lo, hi),
                  "beta_sd": float(np.std([errw.fit_beta(c, lo, hi) for c in curves]))}
    return out


def substrates() -> dict[str, tuple[list[str], list[tuple[int, int]]]]:
    """name -> (node labels, integer edges) on the largest connected component."""
    out = {}
    for name, edges in [("cooccurrence", common.cooccurrence_edges()), ("kg", common.kg_edges())]:
        G = nx.Graph(edges)
        lcc = sorted(max(nx.connected_components(G), key=len))
        idx = {v: k for k, v in enumerate(lcc)}
        out[name] = (lcc, [(idx[a], idx[b]) for a, b in G.subgraph(lcc).edges()])
    return out


def load(stage: str) -> dict:
    return json.load(open(os.path.join(common.RESULTS, f"{stage}.json")))


# ---------------------------------------------------------------- table1

def stage_table1():
    rows = {}
    for name, (labels, edges) in substrates().items():
        G = nx.Graph(edges)
        rows[name] = {
            "N": G.number_of_nodes(),
            "K": G.number_of_edges(),
            "k_mean": 2 * G.number_of_edges() / G.number_of_nodes(),
            "C": nx.average_clustering(G),
            "L": nx.average_shortest_path_length(G),
        }
        print(name, rows[name])
    lcc = set(substrates()["cooccurrence"][0])
    seqs = {}
    for mode in SEQ_MODES:
        s = common.sequence(mode)
        S = errw.heaps_curve(s)
        seqs[mode] = {
            "T": len(s),
            "distinct": int(S[-1]),
            "beta": {w: errw.fit_beta(S, lo, hi) for w, (lo, hi) in WINDOWS.items()},
            "frac_tokens_in_lcc": sum(x in lcc for x in s) / len(s),
            "S": S.tolist(),
        }
        print(mode, {k: v for k, v in seqs[mode].items() if k != "S"})
    common.save_json("table1.json", {"substrates": rows, "sequences": seqs})


# ---------------------------------------------------------------- sweep

def _sim(args):
    name, edges, n, T, dw, reps, seed = args
    mean, curves = errw.simulate(errw.Graph(n, edges), T, dw, reps, seed)
    return name, T, dw, betas(mean, curves), mean


def stage_sweep():
    t1 = load("table1")
    subs = substrates()
    jobs = [(name, edges, len(labels), t1["sequences"][mode]["T"], dw, REPS, 1000 + k)
            for name, (labels, edges) in subs.items()
            for mode in SEQ_MODES
            for k, dw in enumerate(DW_GRID)]
    out = {}
    with ProcessPoolExecutor() as ex:
        for name, T, dw, b, _ in ex.map(_sim, jobs):
            out.setdefault(f"{name}/T={T}", []).append({"dw": dw, **b})
            print(f"{name:12s} T={T:5d} dw={dw:<10g} " + "  ".join(
                f"{w}: {b[w]['beta']:.3f} ±{b[w]['beta_sd']:.3f}" for w in WINDOWS))
    common.save_json("sweep.json", out)


# ---------------------------------------------------------------- fit

def invert(curve: list[dict], window: str, target: float) -> float | None:
    """dw at which the (monotone decreasing) beta(dw) curve first crosses target, by
    log-linear interpolation over dw > 0. None if target is out of range."""
    pts = [(c["dw"], c[window]["beta"]) for c in curve if c["dw"] > 0]
    for (d0, b0), (d1, b1) in zip(pts, pts[1:]):
        if (b0 - target) * (b1 - target) <= 0 and b0 != b1:
            x = np.log(d0) + (target - b0) / (b1 - b0) * (np.log(d1) - np.log(d0))
            return float(np.exp(x))
    return None


def stage_fit():
    t1, sw = load("table1"), load("sweep")
    jobs, keys, out = [], [], {}
    for name, (labels, edges) in substrates().items():
        for mode in SEQ_MODES:
            T = t1["sequences"][mode]["T"]
            curve = sw[f"{name}/T={T}"]
            for w in WINDOWS:
                target = t1["sequences"][mode]["beta"][w]
                dw = invert(curve, w, target)
                key = f"{name}/{mode}/{w}"
                if dw is None:
                    top = max(curve, key=lambda c: c[w]["beta"])
                    out[key] = {"T": T, "beta_target": target, "dw": None,
                                "beta_max": top[w]["beta"], "beta_max_dw": top["dw"]}
                    print(f"{key}: target {target:.3f} unreachable "
                          f"(max beta {top[w]['beta']:.3f} at dw={top['dw']:g})")
                    continue
                jobs.append((name, edges, len(labels), T, dw, REPS, 7))
                keys.append((key, w, target))
    with ProcessPoolExecutor() as ex:
        for (key, w, target), (_, T, dw, b, mean) in zip(keys, ex.map(_sim, jobs)):
            out[key] = {"T": T, "beta_target": target, "dw": dw, "beta_sim": b[w]["beta"],
                        "beta_sd": b[w]["beta_sd"], "beta_sim_all": b, "S_mean": mean.tolist()}
            print(f"{key}: target {target:.3f}  dw*={dw:.4g}  "
                  f"sim beta={b[w]['beta']:.3f} ±{b[w]['beta_sd']:.3f}")
    common.save_json("fit.json", out)


# ---------------------------------------------------------------- corr

LS = list(range(1, 31))
N_NULL = 10


def corr_block(seq, rng) -> dict:
    """Measures for seq plus mean-of-N_NULL scalar summaries for each null (curves
    from the first null draw)."""
    out = {"real": cr.summarize(seq, LS)}
    for null, fn in [("glob", cr.reshuffle_global), ("loc", cr.reshuffle_local)]:
        draws = [cr.summarize(fn(seq, rng), LS) for _ in range(N_NULL)]
        d = dict(draws[0])
        for k in ("interevent_median", "interevent_mean", "entropy_mean"):
            d[k] = float(np.mean([x[k] for x in draws]))
            d[k + "_sd"] = float(np.std([x[k] for x in draws]))
        out[null] = d
    return out


def stage_corr():
    fit = load("fit")
    rng = np.random.default_rng(42)
    labels, edges = substrates()["cooccurrence"]
    g = errw.Graph(len(labels), edges)
    out = {}
    for mode in SEQ_MODES:
        key = f"cooccurrence/{mode}/early"
        if fit[key]["dw"] is None:
            continue
        data = common.sequence(mode)
        out[f"data/{mode}"] = corr_block(data, rng)
        model = errw.walk(g, len(data) - 1, fit[key]["dw"], rng).tolist()
        out[f"errw/{mode}"] = corr_block(model, rng)
        # no-reinforcement reference: same substrate, plain random walk
        out[f"rw/{mode}"] = corr_block(errw.walk(g, len(data) - 1, 0.0, rng).tolist(), rng)
        for src in ("data", "errw", "rw"):
            b = out[f"{src}/{mode}"]
            print(f"{src:5s}/{mode:9s}", "  ".join(
                f"{n}: med dt={b[n]['interevent_median']:.0f} H={b[n]['entropy_mean']:.3f} "
                f"M30={b[n]['M_l'][-1]}" for n in ("real", "loc", "glob")))
    out["ls"] = LS
    common.save_json("corr.json", out)


# ---------------------------------------------------------------- sw

SW_N, SW_M, SW_T, SW_REPS = 10**5, 1, 5 * 10**4, 10
SW_P = [0.0, 0.02, 0.1, 1.0]
SW_DW = [0.0, 0.001, 0.003, 0.01, 0.03, 0.1, 0.3, 1.0, 3.0]


def _sw(args):
    p, dw, seed = args
    rng = np.random.default_rng(seed)
    g = errw.Graph(SW_N, errw.small_world(SW_N, SW_M, p, rng))
    mean, curves = errw.simulate(g, SW_T, dw, SW_REPS, seed)
    return p, dw, errw.fit_beta(mean), float(np.std([errw.fit_beta(c) for c in curves]))


def stage_sw():
    jobs = [(p, dw, 10 * i + j) for i, p in enumerate(SW_P) for j, dw in enumerate(SW_DW)]
    out = {}
    with ProcessPoolExecutor() as ex:
        for p, dw, beta, sd in ex.map(_sw, jobs):
            out.setdefault(str(p), []).append({"dw": dw, "beta": beta, "beta_sd": sd})
            print(f"SW p={p:<5g} dw={dw:<6g} beta={beta:.3f} ±{sd:.3f}")
    common.save_json("sw.json", out)


STAGES = {"table1": stage_table1, "sweep": stage_sweep, "fit": stage_fit,
          "corr": stage_corr, "sw": stage_sw}

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("stages", nargs="*", help=" | ".join(STAGES))
    stages = ap.parse_args().stages or list(STAGES)
    for s in stages:
        if s not in STAGES:
            ap.error(f"unknown stage {s!r}")
    for s in stages:
        STAGES[s]()

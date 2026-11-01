"""Edge-reinforced random walk (ERRW) and Heaps'-law fitting.

Model (paper Eqs. 1-2): on a fixed undirected graph with w^0_ij = 1 for every edge,
a walker at i jumps to neighbour j with probability w_ij / sum_l w_il, then the
traversed edge is reinforced, w_ij <- w_ij + dw. dw is the only parameter.
An "innovation" is the first visit to a node; S(t) = # distinct nodes after t steps,
and Heaps' law is S(t) ~ t^beta.
"""
from __future__ import annotations

import numpy as np


class Graph:
    """Undirected graph as per-node neighbour arrays, plus the reverse index needed to
    reinforce both directions of an edge in O(1)."""

    def __init__(self, n: int, edges):
        nbrs = [[] for _ in range(n)]
        for a, b in edges:
            nbrs[a].append(b)
            nbrs[b].append(a)
        self.n = n
        self.nbr = [np.array(sorted(x), dtype=np.int64) for x in nbrs]
        pos = [{v: k for k, v in enumerate(x)} for x in self.nbr]
        self.rev = [np.array([pos[j][i] for j in self.nbr[i]], dtype=np.int64) for i in range(n)]

    @property
    def degrees(self) -> np.ndarray:
        return np.array([len(x) for x in self.nbr])


def walk(g: Graph, T: int, dw: float, rng: np.random.Generator, start: int | None = None) -> np.ndarray:
    """Return the T+1 visited nodes (including the start) of one ERRW realisation."""
    w = [np.ones(len(x)) for x in g.nbr]
    tot = np.array([len(x) for x in g.nbr], dtype=float)
    i = int(rng.integers(g.n)) if start is None else start
    out = np.empty(T + 1, dtype=np.int64)
    out[0] = i
    u = rng.random(T)
    for t in range(T):
        wi = w[i]
        k = min(int(np.searchsorted(np.cumsum(wi), u[t] * tot[i], side="right")), len(wi) - 1)
        j = int(g.nbr[i][k])
        wi[k] += dw
        w[j][g.rev[i][k]] += dw
        tot[i] += dw
        tot[j] += dw
        out[t + 1] = i = j
    return out


def heaps_curve(seq) -> np.ndarray:
    """S(t) for t = 1..len(seq): number of distinct elements among the first t."""
    seen, s, out = set(), 0, np.empty(len(seq), dtype=np.int64)
    for t, x in enumerate(seq):
        if x not in seen:
            seen.add(x)
            s += 1
        out[t] = s
    return out


def fit_beta(S: np.ndarray, t_min: int = 10, t_max: int | None = None, n_pts: int = 40) -> float:
    """Least-squares slope of log S vs log t on log-spaced t in [t_min, t_max]
    (t_max defaults to len(S)). The same fitter is applied to empirical and
    simulated curves."""
    t = np.unique(np.geomspace(t_min, t_max or len(S), n_pts).astype(int))
    return float(np.polyfit(np.log(t), np.log(S[t - 1]), 1)[0])


def simulate(g: Graph, T: int, dw: float, reps: int, seed: int):
    """Mean S(t) over `reps` walks and the per-walk S(t) curves."""
    rng = np.random.default_rng(seed)
    curves = np.array([heaps_curve(walk(g, T, dw, rng))[1:] for _ in range(reps)], dtype=float)
    return curves.mean(axis=0), curves


def small_world(n: int, m: int, p: float, rng: np.random.Generator) -> list[tuple[int, int]]:
    """Paper's SW construction: ring where each node links to its 2m nearest neighbours,
    then for each ring edge add, with probability p, a new random edge."""
    edges = {(i, (i + d) % n) for i in range(n) for d in range(1, m + 1)}
    edges = {(min(a, b), max(a, b)) for a, b in edges}
    for _ in range(int(rng.binomial(len(edges), p))):
        while True:
            a, b = (int(x) for x in rng.integers(n, size=2))
            e = (min(a, b), max(a, b))
            if a != b and e not in edges:
                edges.add(e)
                break
    return sorted(edges)

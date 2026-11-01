"""Sequence correlation measures (paper Fig. 4, following Tria et al. 2014) and the
two reshuffled null models.

  glob : uniform random permutation of the whole sequence
  loc  : first appearances stay in place; every repeated occurrence is redrawn among the
         non-first slots, constrained to land after its concept's first appearance.
         Preserves S(t) exactly, so any difference from loc is pure temporal correlation.
"""
from __future__ import annotations

from collections import Counter, defaultdict

import numpy as np


def reshuffle_global(seq, rng: np.random.Generator) -> list:
    return [seq[k] for k in rng.permutation(len(seq))]


def reshuffle_local(seq, rng: np.random.Generator) -> list:
    """Fill non-first slots left to right, each with a uniformly random remaining repeat
    of an already-introduced concept. The pool is never empty: the original sequence is
    itself a valid filling, so introduced repeats always outnumber filled slots."""
    seen, first = set(), []
    for x in seq:
        first.append(x not in seen)
        seen.add(x)
    repeats = Counter(x for x, f in zip(seq, first) if not f)
    out, pool = [], []
    for x, f in zip(seq, first):
        if f:
            out.append(x)
            pool += [x] * repeats[x]
        else:
            k = int(rng.integers(len(pool)))
            pool[k], pool[-1] = pool[-1], pool[k]
            out.append(pool.pop())
    return out


def interevent_times(seq) -> np.ndarray:
    """Gaps between consecutive occurrences of the same concept, pooled over concepts."""
    last, gaps = {}, []
    for t, x in enumerate(seq):
        if x in last:
            gaps.append(t - last[x])
        last[x] = t
    return np.array(gaps)


def log_hist(x: np.ndarray, n_bins: int = 25):
    """Log-binned probability density (for heavy-tailed f(dt))."""
    edges = np.unique(np.geomspace(1, x.max() + 1, n_bins + 1).astype(int))
    h, edges = np.histogram(x, bins=edges)
    dens = h / (np.diff(edges) * len(x))
    centers = np.sqrt(edges[:-1] * edges[1:])
    keep = dens > 0
    return centers[keep].tolist(), dens[keep].tolist()


def distinct_subsequences(seq, ls) -> list[int]:
    """M_l: number of distinct length-l windows, for each l in ls."""
    return [len({tuple(seq[i:i + l]) for i in range(len(seq) - l + 1)}) for l in ls]


def entropy_by_frequency(seq):
    """For each concept A with n_A >= 2 occurrences: split the subsequence from A's first
    appearance to the end into n_A equal intervals and take the normalised entropy of
    A's occurrences across them, H_A = -sum f_i ln f_i / ln n_A (1 = evenly spread,
    lower = bursty). Returns {n_A: mean H_A}."""
    pos = defaultdict(list)
    for t, x in enumerate(seq):
        pos[x].append(t)
    T = len(seq)
    by_n = defaultdict(list)
    for ts in pos.values():
        n = len(ts)
        if n < 2:
            continue
        t0 = ts[0]
        bins = np.minimum(((np.array(ts) - t0) * n) // (T - t0), n - 1)
        f = np.bincount(bins, minlength=n) / n
        f = f[f > 0]
        by_n[n].append(float(-(f * np.log(f)).sum() / np.log(n)))
    return {n: float(np.mean(v)) for n, v in sorted(by_n.items())}


def summarize(seq, ls) -> dict:
    gaps = interevent_times(seq)
    ent = entropy_by_frequency(seq)
    counts = Counter(seq)
    # occurrence-weighted mean entropy over concepts with n_A >= 2
    w_ent = sum(ent[counts[x]] * counts[x] for x in counts if counts[x] >= 2)
    w_tot = sum(c for c in counts.values() if c >= 2)
    return {
        "interevent_hist": log_hist(gaps),
        "interevent_median": float(np.median(gaps)),
        "interevent_mean": float(gaps.mean()),
        "M_l": distinct_subsequences(seq, ls),
        "entropy_by_n": ent,
        "entropy_mean": w_ent / w_tot if w_tot else None,
    }

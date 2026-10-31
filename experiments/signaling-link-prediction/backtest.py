"""M3 (part 2) — backtest with stratified K-fold CV x seeds, Table-4-style metrics.

For each (seed, fold): fit on the train folds, score the held-out fold. Unranked
P/R/F1 use a threshold chosen on the TRAIN predictions (max-F1), applied to test
(so the operating point is never tuned on test). Ranked P@10 and MAP (average
precision) use the raw test scores. Results are averaged over folds x seeds.

Usage:  python3 backtest.py --t 2012 --folds 5 --seeds 5
Writes: results/<t>.json
Needs numpy + scikit-learn (see PLAN.md §7 for the /tmp venv).
"""
from __future__ import annotations

import argparse
import json
import os

import numpy as np
from sklearn.metrics import average_precision_score, precision_recall_fscore_support
from sklearn.model_selection import StratifiedKFold

import common
import models


def load_xy(t: int):
    path = os.path.join(common.HERE, "features", f"{t}.jsonl")
    X, y, pairs = [], [], []
    for line in open(path):
        r = json.loads(line)
        X.append(r["feats"]); y.append(r["label"]); pairs.append((r["A"], r["C"]))
    return np.asarray(X, float), np.asarray(y, int), pairs


def precision_at_k(y_true: np.ndarray, scores: np.ndarray, k: int = 10) -> float:
    order = np.argsort(-scores, kind="stable")[:k]
    return float(y_true[order].sum()) / k


def best_f1_threshold(y_true: np.ndarray, scores: np.ndarray) -> float:
    """Threshold on these (train) scores that maximizes F1.

    Vectorized sweep: sort by score desc, and at each prefix (predict-positive
    the top-k) F1 = 2*TP / (2*TP + FP + FN). O(n log n)."""
    P = int(y_true.sum())
    if P == 0:
        return float(scores.max()) + 1.0  # never predict positive
    order = np.argsort(-scores, kind="stable")
    ys = y_true[order]
    ss = scores[order]
    tp = np.cumsum(ys)                       # positives among the top-k
    fp = np.cumsum(1 - ys)
    k = np.arange(1, len(ys) + 1)
    f1 = 2 * tp / (2 * tp + fp + (P - tp))   # FN = P - TP
    # only the last index of each tie group is a valid cut (>= threshold)
    valid = np.ones(len(ss), bool)
    valid[:-1] = ss[1:] != ss[:-1]
    f1 = np.where(valid, f1, -1.0)
    return float(ss[int(np.argmax(f1))])


def eval_scores(y_test, train_scores, test_scores, y_train, fixed_threshold=None):
    thr = fixed_threshold if fixed_threshold is not None else best_f1_threshold(y_train, train_scores)
    pred = (test_scores >= thr).astype(int)
    p, r, f, _ = precision_recall_fscore_support(y_test, pred, average="binary", zero_division=0)
    return {
        "F1": f, "precision": p, "recall": r,
        "P@10": precision_at_k(y_test, test_scores, 10),
        "MAP": average_precision_score(y_test, test_scores),
    }


def run(t: int, folds: int, seeds: int):
    X, y, _ = load_xy(t)
    rate = y.mean()
    acc = {m: [] for m in models.MODELS + ["random", "transitive"]}

    for seed in range(seeds):
        skf = StratifiedKFold(n_splits=folds, shuffle=True, random_state=seed)
        rng = np.random.default_rng(seed)
        for tr, te in skf.split(X, y):
            Xtr, Xte, ytr, yte = X[tr], X[te], y[tr], y[te]

            for name in models.MODELS:
                clf = models.make_model(name, seed)
                clf.fit(Xtr, ytr)
                s_tr = clf.predict_proba(Xtr)[:, 1]
                s_te = clf.predict_proba(Xte)[:, 1]
                acc[name].append(eval_scores(yte, s_tr, s_te, ytr))

            # baselines
            s_te = models.scores_random(ytr, len(yte), rng)
            s_tr = rng.random(len(ytr))
            acc["random"].append(eval_scores(yte, s_tr, s_te, ytr))

            s_te = models.scores_all_positive(len(yte))
            acc["transitive"].append(
                eval_scores(yte, np.ones(len(ytr)), s_te, ytr, fixed_threshold=1.0)
            )

    summary = {
        "t": t, "folds": folds, "seeds": seeds,
        "n_candidates": int(len(y)), "n_positives": int(y.sum()),
        "positive_rate": float(rate),
        "models": {},
    }
    metrics = ["F1", "precision", "recall", "P@10", "MAP"]
    for name, runs in acc.items():
        summary["models"][name] = {
            m: {"mean": float(np.mean([r[m] for r in runs])),
                "std": float(np.std([r[m] for r in runs]))}
            for m in metrics
        }
    return summary


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--t", type=int, default=2012)
    ap.add_argument("--folds", type=int, default=5)
    ap.add_argument("--seeds", type=int, default=5)
    args = ap.parse_args()

    summary = run(args.t, args.folds, args.seeds)
    outdir = os.path.join(common.HERE, "results")
    os.makedirs(outdir, exist_ok=True)
    path = os.path.join(outdir, f"{args.t}.json")
    json.dump(summary, open(path, "w"), indent=2)

    print(f"t={args.t}  {summary['n_candidates']} candidates / {summary['n_positives']} positives"
          f"  (rate {summary['positive_rate']:.4f})  {args.folds}-fold x {args.seeds} seeds")
    print(f"{'model':12s} {'F1':>14} {'precision':>14} {'recall':>14} {'P@10':>12} {'MAP':>12}")
    order = models.MODELS + ["random", "transitive"]
    for name in order:
        m = summary["models"][name]
        def cell(k): return f"{m[k]['mean']:.3f}±{m[k]['std']:.3f}"
        print(f"{name:12s} {cell('F1'):>14} {cell('precision'):>14} {cell('recall'):>14} "
              f"{cell('P@10'):>12} {cell('MAP'):>12}")
    print(f"wrote {path}")


if __name__ == "__main__":
    main()

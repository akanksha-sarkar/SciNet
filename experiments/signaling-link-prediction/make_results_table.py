"""M4 — render results/<t>.json as a Table-4-style markdown block.

Usage:  python3 make_results_table.py --t 2012   (stdlib only)
"""
from __future__ import annotations

import argparse
import json
import os

import common

ORDER = ["adaboost", "rf", "mlp", "random", "transitive"]
LABEL = {"adaboost": "AdaBoost", "rf": "Random Forest", "mlp": "MLP (NN)",
         "random": "Baseline (random)", "transitive": "Baseline (transitive)"}
METRICS = ["F1", "precision", "recall", "P@10", "MAP"]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--t", type=int, default=2012)
    args = ap.parse_args()
    s = json.load(open(os.path.join(common.HERE, "results", f"{args.t}.json")))

    print(f"### Backtest t={s['t']} — {s['n_candidates']} candidates / "
          f"{s['n_positives']} positives (rate {s['positive_rate']:.4f}), "
          f"{s['folds']}-fold CV x {s['seeds']} seeds\n")
    print("| model | " + " | ".join(METRICS) + " |")
    print("|" + "---|" * (len(METRICS) + 1))
    for name in ORDER:
        m = s["models"][name]
        cells = [f"{m[k]['mean']:.3f} ± {m[k]['std']:.3f}" for k in METRICS]
        print(f"| {LABEL[name]} | " + " | ".join(cells) + " |")
    print("\n_Paper reference (not directly comparable — 2M-edge graph): "
          "AdaBoost F1 0.27, P 0.54, R 0.18, P@10 0.90, MAP 0.68._")


if __name__ == "__main__":
    main()

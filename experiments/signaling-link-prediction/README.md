# Signaling link prediction (Luo et al. 2018 recreation, IG-only)

Supervised, temporal link prediction on the SciVista `signaling` knowledge graph,
recreating **Luo, Valenzuela-Escárcega, Hahn-Powell & Surdeanu, "Scientific Discovery
as Link Prediction in Influence and Citation Graphs" (TextGraphs-12, 2018)**
(https://aclanthology.org/W18-1701/), using the **influence-graph + corpus** feature
blocks. See `PLAN.md` for the full design and the citation-graph v2 deferral.

## Idea in one paragraph

Freeze the signaling KG as an unsigned directed "influence" graph at a cutoff year `t`.
A *candidate* is an open 2-path: a pair `(A, C)` with some `B` where `A→B` and `B→C`
exist but `A→C` does not. Each candidate is labelled positive if `A→C` later appears in
a paper published after `t`. A classifier predicts those future links from graph-structure
features. This asks: does the shape of the graph around a gap predict that the gap gets
filled? (The paper's answer: yes, far better than assuming transitivity.)

## Pipeline

```
build_dataset.py   # freeze G_t, generate 2-path candidates + temporal labels
features.py        # 15 influence-graph + corpus features per candidate (Table 3)
backtest.py        # AdaBoost / RF / MLP vs baselines; stratified CV x seeds; P/R/F1, P@10, MAP
make_results_table.py
common.py          # data loading + frozen-graph construction
models.py          # classifier factory + baselines
```

Candidates, features, and results are written under `candidates/`, `features/`, `results/`.

## Running

The candidate and feature stages are pure stdlib:

```bash
python3 build_dataset.py --t 2012
python3 features.py      --t 2012
```

The model stage needs numpy + scikit-learn. This repo's `.venv` does not have them and
there is no `pip`/`uv` on PATH, so provision a scratch venv on local `/tmp` (NFS `$HOME`
stalls on heavy I/O — see the session env note):

```bash
VENV=/tmp/$USER-slp-venv
python3 -m venv "$VENV"
curl -sS https://bootstrap.pypa.io/get-pip.py | "$VENV/bin/python"   # no ensurepip here
"$VENV/bin/python" -m pip install numpy scipy scikit-learn
"$VENV/bin/python" backtest.py --t 2012 --folds 5 --seeds 5
python3 make_results_table.py --t 2012
```

Primary cutoff `t=2012` (matches the paper); `t=2010` is the sensitivity run.

## Data feasibility (current KG: 4,901 edges, 479 papers, full year coverage)

| cutoff `t` | pre-`t` edges | 2-path candidates | positives | neg:pos |
|---|---|---|---|---|
| 2010 | 1,632 | 5,152 | 58 | 88:1 |
| 2012 | 1,917 | 6,526 | 57 | 114:1 |

~100× smaller than the paper's 2M-edge graph, so absolute F1/MAP are not comparable;
the interest is relative — classifiers vs. the random and transitive-closure baselines.

## Results (v1, IG-only; 5-fold CV × 5 seeds, mean ± std)

**t = 2010** (base positive rate 0.0113 — the cleaner cutoff; all classifiers beat both baselines on every ranked metric):

| model | F1 | precision | recall | P@10 | MAP |
|---|---|---|---|---|---|
| AdaBoost | 0.135 ± 0.074 | 0.138 ± 0.104 | 0.165 ± 0.102 | 0.124 ± 0.091 | 0.090 ± 0.043 |
| Random Forest | 0.000 ± 0.000 | 0.000 ± 0.000 | 0.000 ± 0.000 | 0.132 ± 0.079 | 0.101 ± 0.051 |
| MLP (NN) | 0.124 ± 0.088 | 0.171 ± 0.124 | 0.103 ± 0.077 | 0.148 ± 0.090 | 0.087 ± 0.054 |
| Baseline (random) | 0.009 | 0.004 | 0.193 | 0.008 | 0.016 |
| Baseline (transitive) | 0.022 | 0.011 | 1.000 | 0.012 | 0.011 |

**t = 2012** (base rate 0.0087 — matches the paper's cutoff; sparser, so RF/AdaBoost thresholds collapse but the ranked signal survives):

| model | F1 | precision | recall | P@10 | MAP |
|---|---|---|---|---|---|
| AdaBoost | 0.056 ± 0.063 | 0.048 ± 0.060 | 0.080 ± 0.088 | 0.032 ± 0.055 | 0.047 ± 0.028 |
| Random Forest | 0.000 ± 0.000 | 0.000 ± 0.000 | 0.000 ± 0.000 | 0.120 ± 0.089 | 0.067 ± 0.059 |
| MLP (NN) | 0.105 ± 0.073 | 0.168 ± 0.144 | 0.081 ± 0.056 | 0.112 ± 0.071 | 0.064 ± 0.039 |
| Baseline (random) | 0.017 | 0.011 | 0.256 | 0.008 | 0.013 |
| Baseline (transitive) | 0.017 | 0.009 | 1.000 | 0.020 | 0.009 |

**Reading it.** The headline is the lift over baselines, not the absolute scores. At t=2010, MAP ≈ 0.09–0.10 vs. random 0.016 (~6×) and P@10 ≈ 0.12–0.15 vs. random 0.008 (~15×). The transitive-closure baseline (every open 2-path is a link) sits at F1 ≈ 0.02 — so, exactly as in the paper, assuming transitivity is a poor predictor and the graph-structure features are what carry the signal. Absolute numbers are far below the paper's AdaBoost MAP 0.68 because this graph is ~100× smaller (57–58 positives vs. ~5,000); the large ±std reflects that. RF's F1 = 0 is a thresholding artifact (it never crosses its max-F1 train threshold on the held-out fold), while its *ranking* is strong — a reason to lead with MAP/P@10 here.

## Relationship to the LLM experiment

This is the classical / network-science counterpart to a separate LLM experiment
(orrery/rag/graphrag; not included in this repo), on the same substrate and the same
signaling@2018 split, but with engineered graph features + a supervised classifier
instead of an LLM ranker.

# Signaling link prediction — recreating Luo et al. (2018), IG-only

**Paper:** Fan Luo, Marco A. Valenzuela-Escárcega, Gus Hahn-Powell, Mihai Surdeanu.
*Scientific Discovery as Link Prediction in Influence and Citation Graphs.* TextGraphs-12,
2018. https://aclanthology.org/W18-1701/

**Goal of this experiment.** Reproduce the paper's supervised, temporal link-prediction
pipeline on the SciVista `signaling` knowledge graph, using the **influence-graph (IG) +
corpus** features only (Table 3 top + bottom blocks). The **citation-graph** middle block
is deliberately out of scope for v1 (needs within-corpus citations from OpenAlex; see
"Deferred"). This is the classical / network-science counterpart to the LLM framing of a
separate experiment (orrery/rag/graphrag; not included in this repo): same substrate and
temporal split, but engineered graph features + a classifier, scored with F1 / P@10 / MAP.

---

## 1. Task definition (faithful to the paper)

- **Influence graph `G_t`.** Directed graph frozen at cutoff year `t`. Collapse every KG
  relation (`activates`, `inhibits`, `phosphorylates`, …) to a single **unsigned directed
  "influence" edge** `A → C`. An edge is in `G_t` iff its paper's year `≤ t`. (The paper
  likewise treats extractions as generic influence statements.) Node = `subject`/`object`
  `node_id` from `kg/edges.jsonl`.
- **Candidates.** A candidate is an ordered pair `(A, C)`, `A ≠ C`, such that **some
  intermediate `B`** has `A → B` and `B → C` in `G_t`, **and** `A → C` is not already an
  edge in `G_t`. (Open 2-paths = potential triangle closures.)
- **Label.** Positive iff `A → C` first appears in the KG with paper-year `> t`; negative
  otherwise. Negatives are an approximation (some may close after our data ends) — a
  documented limitation, exactly as in the paper.
- **Unit of evaluation.** One row per `(A, C)` pair (a pair reached through several `B`s is
  still one candidate; per-`B` quantities are aggregated — see §3).

**Measured feasibility on the current KG** (`kg/edges.jsonl`, 4,901 edges, years from
`refs.json`, full coverage):

| cutoff `t` | pre-`t` edges | 2-path candidates | positives | neg:pos |
|---|---|---|---|---|
| 2010 | 1,632 | 5,152 | 58 | 88:1 |
| 2012 | 1,917 | 6,526 | 57 | 114:1 |
| 2015 | 2,313 | 8,964 | 48 | 186:1 |

**Primary cutoff: `t = 2012`** (matches the paper; ~57 positives). `t = 2010` kept as a
sensitivity run (slightly more positives, imbalance closest to the paper's ~50:1).

---

## 2. Small-N evaluation protocol (the one real deviation)

The KG is ~100× smaller than the paper's 2M-edge graph, so we get ~50–60 positives, not
~5,000. A single 60/20/20 split would leave ~11 test positives — too noisy. Instead:

- **Stratified 5-fold cross-validation** over candidates, averaged over **5 seeds**
  (paper averaged over 5 runs). Report mean ± std for every metric.
- Grouping guard (paper's rule that identical links from different papers go to one
  partition): our unit is already the `(A, C)` pair, so no pair spans folds by
  construction. The guard is still asserted in code.
- Keep an optional `--single-split 0.6/0.2/0.2` mode to mirror the paper's exact protocol
  for one comparison table.
- Class imbalance handled with `class_weight="balanced"` (or `scale_pos_weight`) and by
  reporting ranked metrics (P@10, MAP) that don't depend on a threshold.

---

## 3. Feature set (Table 3 — IG + corpus blocks only)

All features computed **on `G_t`**. For path features, let `Bset(A,C)` = the set of direct
bridge nodes (every `B` with `A→B`, `B→C` in `G_t`). "Shortest path A→C **not through B**"
is computed as the shortest `A→C` path in `G_t` with `Bset(A,C)` removed — i.e. connectivity
*beyond* the obvious 2-path. (Design choice, documented; the paper's text is per-`(A,B,C)`
triple, which we aggregate to the `(A,C)` unit.)

**Influence-graph block (top of Table 3):**
- `A.outdegree`, `A.indegree`, `C.outdegree`, `C.indegree` — degrees in `G_t`.
- `inbetween.outdegree`, `inbetween.indegree` — summed/averaged degree of nodes lying on
  the shortest A→C paths that avoid `Bset`.
- `shortest_path_length` — length of that shortest path; **0 if none exists**.
- `shortest_path_count` — number of such shortest paths.
- `inbetween.avg_idf` — mean node-IDF of the in-between nodes.
- `rinbetween.avg_seen` — mean "seen" count of the edges on those paths (see below).

**Corpus block (bottom of Table 3):**
- `A.idf`, `B.idf`, `C.idf` — node-IDF of A, C, and the bridge set (B aggregated: mean).
- `r1.seen`, `r2.seen` — number of papers asserting `A→B` and `B→C` (bridge aggregated:
  max and mean kept as two columns).

**Supporting quantities (precomputed once per `t`):**
- **node-IDF**`(n) = log(N_papers / papers(n))`, where `papers(n)` is available directly in
  `kg/nodes.jsonl` (`"papers"` field) — recomputed restricted to papers with year `≤ t`.
- **edge "seen"**`(X→Y)` = number of distinct paper keys (claim_id prefix) among `G_t`
  edges with that `(subject, object)` pair.

No citation-graph features in v1 → the `maxP/minP/avgP`, `Jaccard`, and inter-citation
columns of Table 3 are omitted (see Deferred).

---

## 4. Models & baselines

Classifiers (scikit-learn), hyperparameters tuned on a held-out dev fold:
- **AdaBoost** (paper's best model),
- **Random Forest**,
- **MLP** (the paper's "Neural Network"; small feed-forward).
- (Linear SVM optional, expected not to help — the paper reports it didn't converge.)

Baselines:
- **Random** — predict positive at the training positive rate.
- **Transitive closure / all-positive** — every candidate `(A, C)` is positive (the paper's
  second baseline; expected precision ≈ the base rate, i.e. very low). This directly tests
  "does 2-path connectivity alone predict the link?"

---

## 5. Metrics

Per the paper (Table 4):
- **Unranked:** Precision, Recall, F1 at the operating threshold.
- **Ranked:** **P@10** and **MAP** (mean average precision) over candidates ranked by model
  score. MAP is the headline number for the imbalanced regime.
- Reported per cutoff, per model, mean ± std across folds × seeds, against both baselines.

---

## 6. File layout & key functions

```
experiments/signaling-link-prediction/
  PLAN.md                 # this file
  README.md               # how to run, after build
  common.py               # paths, load_edges(), year map from refs.json, node papers
  build_dataset.py        # freeze G_t, generate candidates + labels -> candidates/<t>.jsonl
  features.py             # feature matrix from candidates + G_t -> features/<t>.npz (+ names)
  models.py               # classifier factory (adaboost/rf/mlp) + baselines
  backtest.py             # CV × seeds, metrics, baseline comparison -> results/<t>.json
  make_results_table.py   # pretty Table-4-style summary (stdout + markdown)
```

Core functions:
- `common.load_influence_edges()` → list of `(A, C, year, paper_key, relation)`.
- `common.freeze(edges, t)` → `G_t` (adjacency out/in), `first_year[(A,C)]`,
  `seen[(A,C)]`, `papers_pre_t`, `node_papers`.
- `build_dataset.generate_candidates(G_t, first_year, t)` → rows
  `{A, C, label, bridges:[B...], ...}`.
- `features.featurize(row, G_t, idf, seen)` → fixed-order vector; `FEATURE_NAMES` constant.
- `backtest.run(t, models, folds=5, seeds=5)` → metrics dict; writes `results/<t>.json`.

Outputs written under `experiments/signaling-link-prediction/{candidates,features,results}/`
(git-ignored like the rest of `experiments/`).

---

## 7. Environment (step 0 — must resolve before coding)

`scikit-learn` / `numpy` are **not** in the repo `.venv`, and neither `pip` nor `uv` is on
PATH in this session. Options, in order of preference:
1. Locate the project's `uv` (repo has `uv.lock`); `uv venv` + `uv pip install
   scikit-learn numpy scipy` into a venv on **local `/tmp`** (per the session env note: NFS
   `$HOME`/`$share` stall on heavy I/O; `/tmp` is local xfs).
2. If no package manager is reachable, bootstrap `pip` via `ensurepip` into a scratch venv.
3. Fallback: pure-numpy implementations are undesirable; prefer getting sklearn.

The candidate/feature stages are **pure-stdlib** and can run and be validated before sklearn
is available; only `models.py`/`backtest.py` need it.

---

## 8. Faithfulness vs. deviations (record for the writeup)

Faithful: 2-path candidate construction; backtest at `t=2012`; IG + corpus features; same
classifier family (AdaBoost/RF/NN); same metrics (P/R/F1, P@10, MAP); random + transitive
baselines; 5-run averaging.

Deviations (all from scale): (a) CV×seeds instead of one 60/20/20 split; (b) no
citation-graph features in v1; (c) relation/sign collapsed to unsigned influence (paper
does the same); (d) multi-`B` aggregation and "path avoids `Bset`" defined explicitly in §3.

---

## 9. Deferred (v2 — "Full paper")

Citation-graph features need within-corpus paper→paper citations (OpenAlex
`referenced_works` over the 479 `refs.json` papers; `discoveries/openalex_cache.json`
already exists as a starting cache). Then: community detection (Coda, or a stand-in such as
Louvain at 100/300 communities), and the `maxP/minP/avgP(p_{A→B}, p_{B→C})`, Jaccard of
paper-sets, and inter-citation-ratio features. The paper's ablation shows two of these
(`maxP`, `Jaccard`) are among the most impactful features, so v2 is where the citation
signal gets tested.

---

## 10. Milestones

1. **M0 env** — provision sklearn/numpy venv on `/tmp`.
2. **M1 data** — `common.py` + `build_dataset.py`; emit `candidates/2012.jsonl`; assert the
   counts in §1 (57 positives / 6,526 candidates at `t=2012`). *Validatable without sklearn.*
3. **M2 features** — `features.py`; emit `features/2012.npz`; sanity-check feature ranges,
   no NaNs, shortest-path=0 handling.
4. **M3 models+eval** — `models.py` + `backtest.py`; produce Table-4-style results for
   `t=2012` (+ `t=2010` sensitivity) with baselines.
5. **M4 writeup** — `README.md` + results table; compare to the paper's F1 0.27 / MAP 0.68
   in relative terms (absolute numbers won't match given scale).

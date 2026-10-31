# SciNet

Project for CS 6850 — Scientific discovery using network dynamics.

## Cell-signaling knowledge graph + dashboard

An interactive dashboard over a knowledge graph mined from the cell-signaling
literature. Every edge is a claim traceable to a verbatim quote in a source
paper.

- **477 papers** · **9,085 claims** · **1,982 nodes** · **4,901 edges**
- Node types: kinases, receptors, effectors, transcription factors, ligands,
  small molecules, …
- Relations: `inhibits`, `activates`, `phosphorylates`, `induces`, `recruits`, …

Views: Overview · **Graph** (interactive network) · Matrix · Plots · Claims ·
Lenses · Hypotheses · Failure modes · Opportunities · Shifts · Audit.

### Run it locally

The app is static but uses ES modules + `fetch`, so it must be served over
HTTP (opening `index.html` from `file://` will not work):

```sh
python3 -m http.server 8000
# then open http://localhost:8000/
```

### Deploy on GitHub Pages

Enable Pages for this repo (Settings → Pages → deploy from `main`, root).
A `.nojekyll` file is included so `views/` and `data/` are served verbatim.
The site will be available at `https://<user>.github.io/SciNet/`.

### Layout

```
index.html          single-domain shell (hash-routed views)
app.js              router + nav + theme
data.js             fetch/cache of the JSON bundle
style.css
views/*.js          one module per view (lazy-loaded)
data/
  domains.json      domain metadata
  signaling/        claims, graph, papers, lenses, discoveries, meta
```

The frontend reads only the static JSON under `data/signaling/`; `graph.json`
(nodes + typed edges) is the network itself, ready for analysis.

## Network experiments

### Link prediction (Luo et al. 2018 recreation)

`experiments/signaling-link-prediction/` — supervised temporal link prediction on
the signaling KG, recreating *"Scientific Discovery as Link Prediction in Influence
and Citation Graphs"* (TextGraphs-12, 2018) with influence-graph features.

Freeze the graph at a cutoff year `t`; each open 2-path `A→B→C` with no `A→C` is a
candidate, labelled positive if `A→C` appears in a later paper. A classifier predicts
which gaps get filled from graph-structure features — testing whether the shape of
the graph around a gap predicts the gap being filled (vs. assuming transitivity).

The candidate and feature stages are pure stdlib and read the KG from
`domains/signaling/` (`kg/edges.jsonl` + `refs/refs.json`), which is included:

```sh
cd experiments/signaling-link-prediction
python3 build_dataset.py --t 2012     # freeze G_t, generate candidates + labels
python3 features.py      --t 2012     # 15 influence-graph features per candidate
python3 make_results_table.py --t 2012  # render the committed results
```

The model stage (`backtest.py`) needs numpy + scikit-learn in a venv — see the
experiment's own `README.md` and `PLAN.md`. Committed `candidates/`, `features/`,
and `results/` reproduce the tables without re-running. Headline: classifiers beat
the random baseline ~6× on MAP and ~15× on P@10, while the transitive-closure
baseline fails (F1 ≈ 0.02) — exactly the paper's qualitative result on a graph
~100× smaller.

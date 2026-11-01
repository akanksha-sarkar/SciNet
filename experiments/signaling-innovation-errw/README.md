# Innovation as an edge-reinforced random walk (Iacopini et al. 2018 recreation)

Recreates **Iacopini, Milojević & Latora, "Network dynamics of innovation processes",
PRL 120, 048301 (2018)** (https://arxiv.org/abs/1707.04239) on the `signaling` KG.

## Idea in one paragraph

Treat the order in which concepts first appear in the literature as an exploration process.
Heaps' law, S(t) ~ t^β, measures how fast new concepts arrive (S = distinct concepts after
t tokens). The paper models discovery as an **edge-reinforced random walk (ERRW)** on the
concept co-occurrence network: every edge starts at weight 1, and a walker steps to a
neighbour with probability ∝ edge weight. Each traversed edge gains δw, the model's only
parameter. Stronger reinforcement keeps the walker on familiar ground and lowers β. The paper
fits δw so the walk reproduces each field's empirical β (Table 1, Fig. 3). It then shows that
the walk also produces the bursty, correlated reuse of concepts seen in real sequences (Fig. 4).

## Mapping to this repo

| paper | here |
|---|---|
| concept = multiword phrase in an abstract | KG node (subject/object of a claim) |
| sequence S ordered by publication date | papers sorted by (year, PMID), concepts in claim order |
| link = co-occur in the same abstract | link = co-occur in the same paper (largest component) |
| walk length = length of the data sequence | same; the walk runs exactly T steps and then stops |
| β = slope of log S vs log t | same fitter on data and walks; t ∈ [10, T], 40 log-spaced points |
| mean over realisations | 50 walks per δw (20 in the paper), random start node |

Two sequence variants: **`distinct`** (primary): each paper contributes its distinct
concepts once, mirroring "phrases that appear in an abstract". **`mentions`**: every
subject/object mention. Its within-paper repeats are an extraction artifact (one sentence →
several edges), so it is reported as a robustness check only. The claim graph itself
(undirected) is a second substrate, alongside the co-occurrence network.

## Pipeline

```bash
python3 run.py      # stages: table1 sweep fit corr sw  (~2 min on 8 cores)
python3 plots.py    # figures/*.png
```

Needs numpy, scipy, networkx, matplotlib (the system `python3` here has them).
`errw.py` holds the walk and the Heaps' fit; `correlations.py` holds the Fig. 4 measures and
the null models; `common.py` handles data loading.

## Results

### Simulator check: the paper's small-world networks (Fig. 2b)

N = 10⁵, m = 1, T = 5·10⁴, 10 walks. Without reinforcement the walk recovers the paper's
limits, β = 0.49 on the ring (theory 1/2) and 0.97 at p = 1 (theory 1). β falls
monotonically with δw for every p, as in the paper. `figures/fig2_sw.png`

### Table 1 analogue

| substrate | N | ⟨k⟩ | C | L |
|---|---|---|---|---|
| co-occurrence (LCC) | 1,951 | 45.0 | 0.83 | 2.57 |
| claim graph (LCC) | 1,773 | 4.1 | 0.07 | 4.62 |
| *paper, 4 fields* | *48k–289k* | *19–172* | *0.41–0.91* | *2.5–3.7* |

| sequence | T | distinct | β (full) | β (t ≤ 1000) |
|---|---|---|---|---|
| distinct | 4,471 | 1,982 | **0.86** | 0.87 |
| mentions | 9,802 | 1,982 | 0.80 | 0.77 |

The empirical β of 0.86 sits inside the paper's range (0.82–0.91). Locally the co-occurrence
network looks like theirs: highly clustered, with short paths. It is ~50× smaller.

### Fitting δw (Fig. 3, Table 1 last column)

**The paper's full-curve fit has no solution here.** Even with no reinforcement (δw = 0) the
walk only reaches β ≈ 0.83 on either substrate, below the literature's 0.86. Reinforcement
can only lower β (`figures/fig_beta_dw.png`, left).

The cause is finite size (`figures/fig3_heaps.png`). Up to t ≈ 1000 the literature finds
concepts slightly *slower* than a plain random walk (β 0.87 vs 0.90), which is the paper's
regime. After that the walk's discovery rate decays as it uses up a ~2k-node network, ending
at ~1,330 of 1,951 nodes. The literature keeps a near-constant rate of ~0.43 new concepts per
token until it has named all 1,982, which it does by construction.

Fitting only the unsaturated window (t ∈ [10, 1000]) does give a solution:

| substrate / sequence | β target | δw* | β at δw* (mean ± sd over walks) |
|---|---|---|---|
| co-occurrence / distinct | 0.868 | **17.5** | 0.874 ± 0.21 |
| co-occurrence / mentions | 0.774 | 47.2 | 0.736 ± 0.30 |
| claim graph / distinct | 0.868 | 0.29 | 0.858 ± 0.11 |
| claim graph / mentions | 0.774 | 3.3 | 0.745 ± 0.28 |

As in the paper, the denser substrate needs much stronger reinforcement for the same β. The
paper fitted δw = 6–330 for ⟨k⟩ = 19–172; δw* = 17.5 at ⟨k⟩ = 45 falls inside that range. The
per-walk spread at δw* is large. In this regime some walks get trapped on a few reinforced
edges and others escape, so the fitted value is only meaningful as a mean.

### Correlations (Fig. 4)

On the `distinct` sequence (T = 4,471), compared with its own reshuffles: **loc** keeps first
appearances and reshuffles repeats after them, so S(t) is unchanged; **glob** is a full
permutation. Null values are means over 10 draws. `figures/fig4_corr.png`

| sequence | median Δt (real / loc / glob) | mean entropy H (real / loc / glob) |
|---|---|---|
| literature | 282 / 291 / 332 | 0.647 / 0.649 / 0.694 |
| ERRW, δw* = 17.5 | **28** / 187 / 224 | **0.560** / 0.722 / 0.748 |
| plain RW, δw = 0 | 388 / 433 / 462 | 0.626 / 0.669 / 0.679 |

The ERRW reproduces the paper's model-side result. It is strongly bursty, with return times
~7× shorter than loc, lower entropy, and repeated short subsequences that the nulls lack.
**The literature sequence is not**: on inter-event times and entropy it sits on top of its
loc null (ΔH = 0.002; loc sd 0.008). Its only departure from glob is the one loc also has,
namely that concepts can't recur before they are introduced. Its one real signal is in
repeated subsequences, and it is short-range: there are 215 repeated length-2 windows
against ~30 in the nulls. These are mostly fixed pairs restated in later papers: paralogs
(ERK1/ERK2, MEK1/MEK2, JAK1/JAK2, p38/JNK) and canonical steps (U0126→MEK, MEK→ERK,
AKT→TSC2). The effect vanishes by l ≈ 4, while the ERRW's
repeats persist past l = 20. The paper found correlations in real sequences like those of
the model. Here the fitted model is far more correlated than the data, so matching β does
not match the temporal structure.

(The `mentions` variant does look bursty, with median Δt 5 vs 211 for loc, but that comes
from repeats within a paper, not from reuse of a concept across papers.)

## Takeaways

1. The simulator reproduces the paper's synthetic results, so the differences below come from the data.
2. The literature's β of 0.86 is in the paper's range, but on a 2k-node network the ERRW can
   match it only before the walk saturates. The fixed-network model has no way to keep
   finding concepts at a constant rate for as long as the literature does.
3. Where β can be fitted, the fitted reinforcement predicts strong burstiness that the
   signaling literature does not show at token resolution.

## Caveats

- **Corpus.** 378 papers hand-picked for coverage over 1991–2026, not a full journal
  record. Curating for breadth inflates novelty and probably removes the
  "follow-up on the same pathway" papers that would create burstiness.
- **Time resolution.** Year plus PMID is a coarse ordering. Within a paper the `distinct`
  sequence has no repeats by construction, so burstiness can only show at Δt above
  roughly the paper size (median 8 concepts). A paper-level version of Fig. 4 would test
  this more directly.
- **Ambiguities in the paper.** The text does not give the β-fit window, the start-node
  rule or the δw search procedure. This recreation uses the choices above and
  log-linear interpolation of the β(δw) curve. Fig. 4 measures follow Tria et al. 2014;
  the supplement's exact definitions could not be machine-read from the PDF.
- **Interpolation on a noisy curve.** For `mentions`, β re-simulated at δw* lands
  0.03–0.04 below the target, inside the per-walk sd.

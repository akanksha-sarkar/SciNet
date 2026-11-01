"""Render figures/*.png from results/*.json (run after run.py).

  fig2_sw.png        beta vs dw on the paper's small-world nets (simulator check, paper Fig. 2b)
  fig_beta_dw.png    beta vs dw on the signaling substrates vs the empirical beta
  fig3_heaps.png     S(t): literature vs plain RW vs ERRW at the fitted dw* (paper Fig. 3c)
  fig4_corr.png      f(dt), repeated windows, H(n) vs glob/loc nulls (paper Fig. 4)
"""
from __future__ import annotations

import json
import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

import common
import errw
import run

# reference palette, light mode: categorical slots 1-3 + neutral; sequential blue ramp
BLUE, ORANGE, AQUA = "#2a78d6", "#eb6834", "#1baf7a"
NEUTRAL = "#8a8984"
SEQ_BLUE = ["#a9c9f0", "#6aa2e6", "#2a78d6", "#14498a"]
INK, INK2, GRID, SURFACE = "#0b0b0b", "#52514e", "#e4e3df", "#fcfcfb"
ZERO_X = 3e-4  # where dw = 0 is drawn on the log axes (left of every swept dw > 0)

plt.rcParams.update({
    "figure.facecolor": SURFACE, "axes.facecolor": SURFACE, "savefig.facecolor": SURFACE,
    "axes.edgecolor": GRID, "axes.labelcolor": INK2, "xtick.color": INK2, "ytick.color": INK2,
    "text.color": INK, "axes.grid": True, "grid.color": GRID, "grid.linewidth": 0.6,
    "axes.spines.top": False, "axes.spines.right": False, "lines.linewidth": 2,
    "font.size": 9, "axes.titlesize": 10, "axes.titleweight": "bold", "legend.frameon": False,
})


def load(name):
    return json.load(open(os.path.join(common.RESULTS, f"{name}.json")))


def save(fig, name):
    os.makedirs(common.FIGURES, exist_ok=True)
    fig.savefig(os.path.join(common.FIGURES, name), dpi=160, bbox_inches="tight")
    plt.close(fig)
    print("wrote", name)


def dw_axis(ax, grid):
    ax.set_xscale("log")
    ticks = [ZERO_X] + [x for x in [1e-3, 1e-2, 1e-1, 1, 10, 100, 1000] if min(g for g in grid if g > 0) <= x <= max(grid)]
    ax.set_xticks(ticks, ["0"] + [f"{x:g}" for x in ticks[1:]])
    ax.set_xlabel("reinforcement δw")
    ax.set_ylabel("Heaps' exponent β")
    ax.set_ylim(0, 1.05)


def xs(curve):
    return [c["dw"] if c["dw"] > 0 else ZERO_X for c in curve]


def fig_sw():
    sw = load("sw")
    fig, ax = plt.subplots(figsize=(5, 3.4))
    for color, (p, curve) in zip(SEQ_BLUE, sw.items()):
        ax.plot(xs(curve), [c["beta"] for c in curve], "-o", color=color, ms=4, label=f"p = {float(p):g}")
    for y, lab in [(0.5, "ring RW, β = 1/2"), (1.0, "ER RW, β = 1")]:
        ax.axhline(y, color=NEUTRAL, lw=1, ls=":")
        ax.text(1.5, y + 0.015, lab, color=INK2, fontsize=8)
    dw_axis(ax, [c["dw"] for c in curve])
    ax.set_title("Small-world sanity check (N = 10⁵, m = 1, T = 5·10⁴)")
    ax.legend(loc="lower left", title="shortcut prob.")
    save(fig, "fig2_sw.png")


def fig_beta_dw():
    t1, sw, fit = load("table1"), load("sweep"), load("fit")
    T = t1["sequences"]["distinct"]["T"]
    fig, axes = plt.subplots(1, 2, figsize=(9, 3.4), sharey=True)
    for ax, w, title in zip(axes, ["full", "early"], ["Full curve, t ∈ [10, T]  (paper)",
                                                     "Unsaturated window, t ∈ [10, 1000]"]):
        target = t1["sequences"]["distinct"]["beta"][w]
        for name, color, lab in [("cooccurrence", BLUE, "co-occurrence net"), ("kg", ORANGE, "claim graph")]:
            curve = sw[f"{name}/T={T}"]
            b = np.array([c[w]["beta"] for c in curve])
            sd = np.array([c[w]["beta_sd"] for c in curve])
            ax.fill_between(xs(curve), np.clip(b - sd, 0, None), b + sd, color=color, alpha=0.12, lw=0)
            ax.plot(xs(curve), b, "-o", color=color, ms=3.5, label=lab)
            f = fit[f"{name}/distinct/{w}"]
            if f["dw"]:
                ax.plot([f["dw"]], [target], "o", ms=9, mfc="none", mec=color, mew=2)
                ax.annotate(f"δw* = {f['dw']:.3g}", (f["dw"], target),
                            xytext=(-70, 14) if name == "cooccurrence" else (-62, -22),
                            textcoords="offset points", color=INK2, fontsize=8)
        ax.axhline(target, color=INK, lw=1.2, ls="--")
        ax.text(400, target - 0.1, f"literature\nβ = {target:.2f}", color=INK, fontsize=8, ha="center")
        dw_axis(ax, [c["dw"] for c in curve])
        ax.set_title(title)
    axes[1].set_ylabel("")
    axes[0].legend(loc="lower left")
    fig.suptitle("β(δw) on the signaling substrates, walk length T = 4,471 (band = ±1 sd across walks)",
                 fontsize=9, color=INK2, y=1.02)
    save(fig, "fig_beta_dw.png")


def fig_heaps():
    t1, fit = load("table1"), load("fit")
    S = np.array(t1["sequences"]["distinct"]["S"])
    T = len(S)
    labels, edges = run.substrates()["cooccurrence"]
    rw, _ = errw.simulate(errw.Graph(len(labels), edges), T, 0.0, run.REPS, 3)
    f = fit["cooccurrence/distinct/early"]
    t = np.arange(1, T + 1)
    fig, ax = plt.subplots(figsize=(5, 3.6))
    ax.loglog(t, S, color=INK, label=f"literature (β = {t1['sequences']['distinct']['beta']['full']:.2f})")
    ax.loglog(t, rw, color=BLUE, label="random walk, δw = 0")
    ax.loglog(t, f["S_mean"], color=ORANGE, label=f"ERRW, δw* = {f['dw']:.3g}")
    ax.axvline(1000, color=NEUTRAL, lw=1, ls=":")
    ax.text(1050, 3, "early-fit\nwindow ends", color=INK2, fontsize=8)
    ax.axhline(len(labels), color=NEUTRAL, lw=1, ls=":")
    ax.text(150, len(labels) * 1.12, f"N = {len(labels):,} (network size)", color=INK2, fontsize=8)
    ax.set_xlabel("t (concept tokens / walk steps)")
    ax.set_ylabel("S(t), distinct concepts")
    ax.set_title("Heaps' law: literature vs walks on the co-occurrence net")
    ax.legend(loc="upper left")
    save(fig, "fig3_heaps.png")


def fig_corr():
    c = load("corr")
    ls = np.array(c["ls"])
    rows = [("data/distinct", "Literature"), ("errw/distinct", "ERRW at δw*")]
    n_tok = len(common.sequence("distinct"))
    fig, axes = plt.subplots(2, 3, figsize=(11, 6))
    styles = [("real", "sequence", BLUE, "-"), ("loc", "loc null", ORANGE, "-"), ("glob", "glob null", NEUTRAL, "--")]
    for r, (key, rowlab) in enumerate(rows):
        b = c[key]
        for name, lab, color, ls_ in styles:
            x, y = b[name]["interevent_hist"]
            axes[r, 0].loglog(x, y, ls_, color=color, label=lab)
            deficit = (n_tok - ls + 1) - np.array(b[name]["M_l"])
            axes[r, 1].plot(ls[1:], deficit[1:], ls_, color=color, label=lab)  # l=1 is just T-S(T)
            ent = {int(k): v for k, v in b[name]["entropy_by_n"].items()}
            ns = sorted(ent)
            axes[r, 2].semilogx(ns, [ent[n] for n in ns], ls_, color=color, label=lab, marker="o", ms=3, lw=1.2)
        axes[r, 0].set_ylabel(f"{rowlab}\n\nf(Δt)")
        axes[r, 1].set_ylabel("repeated windows, (T−l+1) − M_l")
        axes[r, 2].set_ylabel("normalised entropy H")
        axes[r, 2].set_ylim(0, 1.05)
    for ax, title in zip(axes[0], ["(a) inter-event times", "(b) repeated subsequences",
                                   "(c) entropy vs frequency"]):
        ax.set_title(title)
    for ax, xl in zip(axes[1], ["Δt (tokens)", "window length l", "occurrences n"]):
        ax.set_xlabel(xl)
    axes[0, 0].legend(loc="lower left")
    fig.suptitle("Correlations vs reshuffled nulls (distinct-concept sequence, T = 4,471)", color=INK2, fontsize=9)
    fig.tight_layout()
    save(fig, "fig4_corr.png")


if __name__ == "__main__":
    fig_sw()
    fig_beta_dw()
    fig_heaps()
    fig_corr()

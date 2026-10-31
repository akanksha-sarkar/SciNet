"""Shared data loading + frozen-graph construction for the signaling
link-prediction recreation (Luo et al. 2018, IG-only). Pure stdlib.

Vocabulary:
  influence edge  : a KG edge collapsed to an unsigned directed pair (A -> C)
  G_t             : influence graph frozen at cutoff year t (edges with paper-year <= t)
  pair            : an ordered (A, C) node pair
  paper key       : the claim_id prefix (e.g. "albeck2013:findings:004" -> "albeck2013")
"""
from __future__ import annotations

import json
import math
import os
from collections import defaultdict
from dataclasses import dataclass, field

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
DOMAIN = os.path.join(REPO, "domains", "signaling")
EDGES = os.path.join(DOMAIN, "kg", "edges.jsonl")
NODES = os.path.join(DOMAIN, "kg", "nodes.jsonl")
REFS = os.path.join(DOMAIN, "refs", "refs.json")


def paper_key(claim_id: str) -> str:
    return claim_id.split(":", 1)[0]


def load_year_map() -> dict[str, int]:
    refs = json.load(open(REFS))
    out: dict[str, int] = {}
    for r in refs:
        k, y = r.get("key"), r.get("year")
        if k and y:
            out[k] = int(y)
    return out


@dataclass
class InfluenceEdge:
    a: str
    c: str
    year: int
    paper: str
    relation: str


def load_influence_edges() -> list[InfluenceEdge]:
    """Every KG edge as an unsigned directed influence edge with its paper year."""
    year = load_year_map()
    out: list[InfluenceEdge] = []
    for line in open(EDGES):
        e = json.loads(line)
        pk = paper_key(e["claim_id"])
        y = year.get(pk)
        if y is None:  # full coverage expected; skip defensively
            continue
        out.append(InfluenceEdge(e["subject"], e["object"], y, pk, e["relation"]))
    return out


@dataclass
class FrozenGraph:
    """Influence graph frozen at cutoff year t, plus the quantities the
    feature stage needs."""
    t: int
    out: dict[str, set[str]]          # A -> {C : A->C in G_t}
    inn: dict[str, set[str]]          # C -> {A : A->C in G_t}
    first_year: dict[tuple[str, str], int]   # (A,C) -> earliest year the pair appears (ANY year)
    seen: dict[tuple[str, str], int]  # (A,C) -> # distinct papers asserting it in G_t
    node_papers: dict[str, int]       # node -> # distinct papers touching it in G_t
    n_papers: int                     # # distinct papers in G_t
    _idf_cache: dict[str, float] = field(default_factory=dict)

    def idf(self, node: str) -> float:
        """log(N_papers / papers(node)); 0 for a node absent from G_t."""
        if node in self._idf_cache:
            return self._idf_cache[node]
        p = self.node_papers.get(node, 0)
        v = math.log(self.n_papers / p) if p > 0 else 0.0
        self._idf_cache[node] = v
        return v


def freeze(edges: list[InfluenceEdge], t: int) -> FrozenGraph:
    out: dict[str, set[str]] = defaultdict(set)
    inn: dict[str, set[str]] = defaultdict(set)
    first_year: dict[tuple[str, str], int] = {}
    pair_papers: dict[tuple[str, str], set[str]] = defaultdict(set)
    node_papers: dict[str, set[str]] = defaultdict(set)
    papers_pre: set[str] = set()

    for e in edges:
        key = (e.a, e.c)
        # earliest appearance of this pair across ALL years (decides positives)
        if key not in first_year or e.year < first_year[key]:
            first_year[key] = e.year
        if e.year <= t:
            out[e.a].add(e.c)
            inn[e.c].add(e.a)
            pair_papers[key].add(e.paper)
            node_papers[e.a].add(e.paper)
            node_papers[e.c].add(e.paper)
            papers_pre.add(e.paper)

    return FrozenGraph(
        t=t,
        out=dict(out),
        inn=dict(inn),
        first_year=first_year,
        seen={k: len(v) for k, v in pair_papers.items()},
        node_papers={k: len(v) for k, v in node_papers.items()},
        n_papers=len(papers_pre),
    )

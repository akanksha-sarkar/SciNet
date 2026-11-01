"""Shared data loading for the ERRW / Heaps'-law recreation (Iacopini, Milojevic &
Latora, "Network dynamics of innovation processes", PRL 120, 048301, 2018).

Vocabulary:
  concept      : a KG node id (the analogue of the paper's multiword phrase)
  sequence S   : concepts in order of appearance in the literature; papers sorted by
                 (year, PMID), concepts within a paper in claim order
  co-occurrence: two concepts linked if they appear in the same paper (the paper links
                 phrases that appear in the same abstract)
  paper key    : the claim_id prefix (e.g. "albeck2013:findings:004" -> "albeck2013")
"""
from __future__ import annotations

import json
import os
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, "..", ".."))
DOMAIN = os.path.join(REPO, "domains", "signaling")
EDGES = os.path.join(DOMAIN, "kg", "edges.jsonl")
REFS = os.path.join(DOMAIN, "refs", "refs.json")
RESULTS = os.path.join(HERE, "results")
FIGURES = os.path.join(HERE, "figures")


def paper_key(claim_id: str) -> str:
    return claim_id.split(":", 1)[0]


def paper_order() -> dict[str, tuple[int, int]]:
    """paper key -> (year, pmid) sort key. PMIDs are assigned at indexing time, so
    they are a rough within-year chronology (the paper orders by publication date)."""
    out = {}
    for r in json.load(open(REFS)):
        if r.get("key") and r.get("year"):
            pmid = int(r["pmid"]) if str(r.get("pmid") or "").isdigit() else 0
            out[r["key"]] = (int(r["year"]), pmid)
    return out


def paper_concepts() -> list[tuple[str, list[str]]]:
    """[(paper key, concept mentions in claim order)] sorted chronologically.
    Each KG edge contributes its subject then its object."""
    order = paper_order()
    mentions: dict[str, list[str]] = defaultdict(list)
    for line in open(EDGES):
        e = json.loads(line)
        pk = paper_key(e["claim_id"])
        if pk in order:
            mentions[pk] += [e["subject"], e["object"]]
    return sorted(mentions.items(), key=lambda kv: order[kv[0]])


def sequence(mode: str = "distinct") -> list[str]:
    """The empirical concept sequence S.
    distinct : each paper contributes its distinct concepts once (first-mention order),
               mirroring "phrases that appear in an abstract" (primary)
    mentions : every subject/object mention of every claim (robustness variant)
    """
    out: list[str] = []
    for _, ms in paper_concepts():
        out += list(dict.fromkeys(ms)) if mode == "distinct" else ms
    return out


def cooccurrence_edges() -> set[tuple[str, str]]:
    edges = set()
    for _, ms in paper_concepts():
        cs = sorted(set(ms))
        for i in range(len(cs)):
            for j in range(i + 1, len(cs)):
                edges.add((cs[i], cs[j]))
    return edges


def kg_edges() -> set[tuple[str, str]]:
    """The claim graph itself, undirected and without self-loops (variant substrate)."""
    edges = set()
    for line in open(EDGES):
        e = json.loads(line)
        a, b = e["subject"], e["object"]
        if a != b:
            edges.add((min(a, b), max(a, b)))
    return edges


def save_json(name: str, obj) -> str:
    os.makedirs(RESULTS, exist_ok=True)
    path = os.path.join(RESULTS, name)
    with open(path, "w") as f:
        json.dump(obj, f, indent=1)
    return path

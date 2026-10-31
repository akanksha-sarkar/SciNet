"""M3 (part 1) — classifier factory + baselines.

Classifiers mirror Luo et al. 2018 Table 4: AdaBoost (their best), Random Forest,
and an MLP (their "Neural Network"). Baselines: random (predict at the train
positive rate) and transitive-closure / all-positive (every open 2-path is a link).
"""
from __future__ import annotations

import numpy as np
from sklearn.ensemble import AdaBoostClassifier, RandomForestClassifier
from sklearn.neural_network import MLPClassifier
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler


def make_model(name: str, seed: int):
    if name == "adaboost":
        return AdaBoostClassifier(n_estimators=200, learning_rate=0.5, random_state=seed)
    if name == "rf":
        return RandomForestClassifier(
            n_estimators=300, class_weight="balanced", random_state=seed, n_jobs=-1
        )
    if name == "mlp":
        return make_pipeline(
            StandardScaler(),
            # no early_stopping: its validation split starves on ~57 positives
            MLPClassifier(hidden_layer_sizes=(32, 16), max_iter=800, random_state=seed),
        )
    raise ValueError(name)


MODELS = ["adaboost", "rf", "mlp"]


def scores_random(y_train: np.ndarray, n_test: int, rng: np.random.Generator) -> np.ndarray:
    """Random ranking; its expected AP/P@10 is the base positive rate."""
    return rng.random(n_test)


def scores_all_positive(n_test: int) -> np.ndarray:
    """Transitive-closure baseline: every candidate scored 1.0 (all predicted positive)."""
    return np.ones(n_test)

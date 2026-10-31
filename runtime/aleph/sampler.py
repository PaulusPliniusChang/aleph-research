"""Exploration-to-strategy sampling for the first runtime version."""

from __future__ import annotations

import math
import random
from typing import Any

from . import observability

STRATEGIES = ("L0", "L1", "L2", "L3")

# Prior quality estimates.  L0 is cheap and reliable, L3 is expensive.
PRIORS = {"L0": 0.90, "L1": 0.85, "L2": 0.75, "L3": 0.60}
FLOOR = 0.03


def tau_for(exploration: float) -> float:
    value = min(1.0, max(0.0, exploration))
    return 0.15 + 0.45 * value


def probabilities(
    exploration: float,
    q: dict[str, float] | None = None,
    floor: float = FLOOR,
) -> tuple[dict[str, float], dict[str, float], float]:
    q = dict(q or PRIORS)
    tau = tau_for(exploration)
    exps = {name: math.exp(q[name] / tau) for name in STRATEGIES}
    total = sum(exps.values())
    probs = {name: max(floor, exps[name] / total) for name in STRATEGIES}
    norm = sum(probs.values())
    probs = {name: value / norm for name, value in probs.items()}
    return probs, q, tau


def sample(
    exploration: float,
    seed: int | None = None,
    q: dict[str, float] | None = None,
) -> dict[str, Any]:
    probs, q_values, tau = probabilities(exploration, q)
    rng = random.Random(seed)
    roll = rng.random()
    cumulative = 0.0
    chosen = STRATEGIES[-1]
    for name in STRATEGIES:
        cumulative += probs[name]
        if roll <= cumulative:
            chosen = name
            break
    observability.get().add_counter(
        "aleph.strategy.samples", 1, {"aleph.strategy": chosen}
    )
    return {
        "strategy": chosen,
        "probabilities": probs,
        "q": q_values,
        "tau": tau,
        "exploration": exploration,
        "seed": seed,
    }


def base_branch(strategy: str, sota_branch: str | None, initialize: str = "initialize") -> str:
    if strategy == "L3":
        return initialize
    return sota_branch or initialize

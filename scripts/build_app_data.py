"""Build the PWA data bundle: every question + the fixed list of Білети.

Usage: python3 scripts/build_app_data.py
Reads data/questions.json, writes app/data/bank.json.

Each Білет has 20 questions: 10 ПДР, 4 безпека, 4 будова, 2 домедична допомога.
The number of Білети is the smallest number that lets every question of every
category appear at least once. Categories with fewer questions are reused
(evenly, in reshuffled passes); no Білет contains the same question twice.
Generation is seeded, so Білет N is always the same.
"""
import json
import math
import random
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEED = 20251029  # date of the answer-key order; any fixed value works

CATEGORIES = [
    # key, title shown in the app, questions per Білет, sections
    ("safety", "Основи безпеки руху", 4, {"35", "38"}),
    ("vehicle", "Будова та експлуатація автомобіля", 4, {"31", "45"}),
    ("medical", "Домедична допомога", 2, {"37"}),
    ("rules", "Загальні Правила дорожнього руху", 10, None),  # everything else
]
ORDER = ["rules", "safety", "vehicle", "medical"]  # order inside a Білет


def category_of(section):
    for key, _, _, sections in CATEGORIES:
        if sections is None or section in sections:
            return key


def fill(pool, n_tickets, per_ticket, rng):
    """Deal questions from `pool` into n_tickets slots of per_ticket each.
    Every question is used before any repeats; no duplicates inside a ticket."""
    tickets = [[] for _ in range(n_tickets)]
    deck = []
    for t in tickets:
        while len(t) < per_ticket:
            if not deck:
                deck = pool[:]
                rng.shuffle(deck)
            # take the first card not already in this ticket
            for i, qid in enumerate(deck):
                if qid not in t:
                    t.append(deck.pop(i))
                    break
            else:  # whole remaining deck is already in this ticket: start a new pass
                fresh = [q for q in pool if q not in t and q not in deck]
                rng.shuffle(fresh)
                deck.extend(fresh)
    return tickets


def main():
    questions = json.loads((ROOT / "data/questions.json").read_text())
    rng = random.Random(SEED)
    pools = {key: [] for key, *_ in CATEGORIES}
    for q in questions:
        pools[category_of(q["section"])].append(q["id"])

    n_tickets = max(math.ceil(len(pools[k]) / per) for k, _, per, _ in CATEGORIES)
    dealt = {k: fill(pools[k], n_tickets, per, rng) for k, _, per, _ in CATEGORIES}
    tickets = [[qid for k in ORDER for qid in dealt[k][i]] for i in range(n_tickets)]

    # --- checks -------------------------------------------------------------
    all_ids = {q["id"] for q in questions}
    used = {qid for t in tickets for qid in t}
    assert used == all_ids, f"not covered: {sorted(all_ids - used)}"
    assert all(len(t) == 20 and len(set(t)) == 20 for t in tickets)

    titles = {k: t for k, t, *_ in CATEGORIES}
    bank = {
        "version": 1,
        "categories": [{"key": k, "title": titles[k],
                        "per_ticket": next(p for kk, _, p, _ in CATEGORIES if kk == k),
                        "questions": len(pools[k])} for k in ORDER],
        "questions": {q["id"]: {
            "s": q["section"], "st": q["section_title"], "c": category_of(q["section"]),
            "q": q["question"], "o": q["options"], "a": q["correct"],
            "img": [p.replace("images/", "") for p in q["images"]],
        } for q in questions},
        "tickets": tickets,
    }
    out = ROOT / "app/data/bank.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(bank, ensure_ascii=False, separators=(",", ":")))
    print(f"{len(questions)} questions, {n_tickets} Білети -> {out.relative_to(ROOT)}")
    for k in ORDER:
        uses = sum(t.count(q) for t in tickets for q in pools[k])
        print(f"  {k:8} {len(pools[k]):5} questions, {uses / len(pools[k]):.1f} uses each on average")


if __name__ == "__main__":
    main()

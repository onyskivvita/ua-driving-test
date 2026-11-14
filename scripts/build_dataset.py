"""Merge parsed questions with the transcribed answer key and validate.

Usage: python3 scripts/build_dataset.py [transcription.txt]
Reads data/questions_raw.json + data/answers/transcription_pass1.txt,
writes data/questions.json and data/questions.csv.
"""
import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Known typos in the source PDF, fixed in the output (section, number) -> fn
TEXT_FIXES = {
    ("16.1", 34): lambda q: {**q, "options": [o.replace("».", "").strip() if o.endswith("».") else o
                                              for o in q["options"]]},
    # sign numbers printed under the pictures leaked into the question text
    ("26", 1): lambda q: {**q, "text": q["text"].replace(" 5.34 5.53", "")},
}


def load_key(path):
    key, sec, errors = {}, None, []
    for ln, line in enumerate(Path(path).read_text().splitlines(), 1):
        line = line.split("#")[0].strip()
        if not line:
            continue
        if line.startswith("S "):
            sec = line[2:].strip()
            if sec in key:
                errors.append(f"line {ln}: section {sec} repeated")
            key[sec] = {}
            nxt = 1
            continue
        first, answers = line.split(":")
        first = int(first)
        if first != nxt:
            errors.append(f"line {ln}: section {sec} row starts at {first}, expected {nxt}")
        for i, a in enumerate(answers.split()):
            key[sec][first + i] = int(a)
        nxt = first + len(answers.split())
    return key, errors


def main():
    tpath = sys.argv[1] if len(sys.argv) > 1 else ROOT / "data/answers/transcription_pass1.txt"
    key, errors = load_key(tpath)
    raw = json.loads((ROOT / "data/questions_raw.json").read_text())
    out = []
    for s in raw["sections"]:
        sk = key.get(s["id"])
        if sk is None:
            errors.append(f"section {s['id']}: no answers")
            continue
        if len(sk) != len(s["questions"]):
            errors.append(f"section {s['id']}: {len(s['questions'])} questions, {len(sk)} answers")
        for q in s["questions"]:
            q = TEXT_FIXES.get((s["id"], q["number"]), lambda x: x)(q)
            a = sk.get(q["number"])
            if a is None:
                errors.append(f"{s['id']}/{q['number']}: no answer")
                continue
            if not 1 <= a <= len(q["options"]):
                errors.append(f"{s['id']}/{q['number']}: answer {a} but only {len(q['options'])} options")
            out.append({
                "id": f"{s['id']}-{q['number']}",
                "section": s["id"],
                "section_title": s["title"],
                "number": q["number"],
                "question": q["text"],
                "options": q["options"],
                "correct": a,
                "correct_text": q["options"][a - 1] if 1 <= a <= len(q["options"]) else None,
                "images": ["images/" + f for f in q["image_files"]],
                "source_page": q["page"],
            })
    for e in errors:
        print("ERROR", e)
    if errors:
        sys.exit(1)
    (ROOT / "data/questions.json").write_text(json.dumps(out, ensure_ascii=False, indent=1))
    with open(ROOT / "data/questions.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["id", "section", "number", "question", "option_1", "option_2", "option_3",
                    "option_4", "option_5", "correct", "correct_text", "images", "source_page"])
        for q in out:
            opts = q["options"] + [""] * (5 - len(q["options"]))
            w.writerow([q["id"], q["section"], q["number"], q["question"], *opts, q["correct"],
                        q["correct_text"], ";".join(q["images"]), q["source_page"]])
    print(f"OK: {len(out)} questions")


if __name__ == "__main__":
    main()

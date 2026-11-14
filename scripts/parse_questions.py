"""Parse questions.pdf into structured JSON.

Scope (per user): sections 1-39 (general, pages 1-419) and section 44
(additional questions for categories B1, B - general, pages 438-442) and section 45
(B1, B - vehicle construction and terms, pages 442-452).

Usage: python3 scripts/parse_questions.py
Writes data/questions_raw.json and data/images/*.jpg
"""
import json
import re
import sys
from pathlib import Path

import pymupdf

ROOT = Path(__file__).resolve().parent.parent
PDF = ROOT / "data/raw/questions.pdf"
OUT = ROOT / "data/questions_raw.json"
IMG_DIR = ROOT / "data/images"

# (first page, last page) 1-based, inclusive. Section boundaries are
# detected from headings; pages outside these ranges are ignored.
PAGE_RANGES = [(1, 419), (438, 452)]
WANTED_SECTIONS = {str(i) for i in range(1, 40)} | {"8.1", "8.2", "16.1", "16.2", "44", "45"}
WANTED_SECTIONS -= {"8", "16"}

SECTION_RE = re.compile(r"^(\d+(?:\.\d+)?)\.\s*(.+)$")
QUESTION_RE = re.compile(r"^(\d+)\.\s*(.*)$")
OPTION_RE = re.compile(r"^(\d)\)\s*(.*)$")
# a few questions number their options "1." instead of "1)"
BULLET = "\u2022"
OPTION_DOT_RE = re.compile(r"^(\d)\.\s*(.*)$")


def is_heading(text):
    m = SECTION_RE.match(text)
    if not m:
        return None
    letters = [c for c in m.group(2) if c.isalpha()]
    if len(letters) < 5:
        return None
    if sum(c.isupper() for c in letters) / len(letters) < 0.8:
        return None
    return m.group(1), m.group(2).strip()


def stream(doc):
    """Yield items in reading order: ('line', text, page, bbox) / ('img', page, bbox)."""
    for first, last in PAGE_RANGES:
        for pno in range(first - 1, last):
            page = doc[pno]
            items = []
            blocks = page.get_text("dict")["blocks"]
            # Some options use a tiny picture of the option number instead of
            # text ("1)"); treat those as option bullets on the line beside them.
            bullets = [b["bbox"] for b in blocks if b["type"] == 1
                       and b["bbox"][2] - b["bbox"][0] < 15 and b["bbox"][3] - b["bbox"][1] < 15]
            for b in blocks:
                if b["type"] == 1 and b["bbox"] in bullets:
                    continue
                if b["type"] == 1:
                    items.append((b["bbox"][1], b["bbox"][0], ("img", pno + 1, tuple(b["bbox"]))))
                    continue
                for l in b["lines"]:
                    t = "".join(s["text"] for s in l["spans"]).strip()
                    if not t:
                        continue
                    # page number at top of page
                    if l["bbox"][1] < 55 and re.fullmatch(r"\d+", t):
                        continue
                    lb = l["bbox"]
                    if any(bb[0] < lb[0] + 15 and lb[1] - 2 <= (bb[1] + bb[3]) / 2 <= lb[3] + 2
                           for bb in bullets):
                        t = BULLET + t
                    items.append((l["bbox"][1], l["bbox"][0], ("line", t, pno + 1, tuple(l["bbox"]))))
            # merge fragments on the same visual line (justified text is
            # sometimes emitted word by word)
            items.sort(key=lambda x: (x[0], x[1]))
            merged = []
            for y, x, it in items:
                prev = merged[-1] if merged else None
                if (it[0] == "line" and prev and prev[2][0] == "line"
                        and abs(prev[0] - y) < 3):
                    frags = prev[3] + [(x, it[1])]
                    frags.sort()
                    text = " ".join(t for _, t in frags)
                    merged[-1] = (prev[0], prev[1], ("line", text, it[2], prev[2][3]), frags)
                else:
                    merged.append((y, x, it, [(x, it[1])] if it[0] == "line" else None))
            for _, _, it, _ in merged:
                yield it


def main():
    doc = pymupdf.open(PDF)
    IMG_DIR.mkdir(parents=True, exist_ok=True)
    sections = []
    cur_sec = None
    q = None
    mode = None  # 'q' | 'opt' | 'heading'
    warnings = []

    def finish():
        nonlocal q
        if q is not None:
            cur_sec["questions"].append(q)
        q = None

    for it in stream(doc):
        if it[0] == "line":
            _, text, pno, bbox = it
            h = is_heading(text)
            if h:
                finish()
                cur_sec = {"id": h[0], "title": h[1], "page": pno, "questions": []}
                sections.append(cur_sec)
                mode = "heading"
                continue
            if cur_sec is None:
                continue  # document title
            if mode == "heading" and not QUESTION_RE.match(text):
                cur_sec["title"] += " " + text  # wrapped heading
                continue
            mq = QUESTION_RE.match(text)
            expected = (q["number"] + 1) if q else 1
            if mq and int(mq.group(1)) == expected and (q is None or len(q["options"]) >= 2):
                finish()
                q = {"number": expected, "text": mq.group(2), "options": [], "images": [],
                     "page": pno}
                mode = "q"
                continue
            if text.startswith(BULLET) and q is not None:
                q["options"].append(text[1:].strip())
                mode = "opt"
                continue
            mo = OPTION_RE.match(text) or OPTION_DOT_RE.match(text)
            if mo and q is not None and int(mo.group(1)) == len(q["options"]) + 1:
                q["options"].append(mo.group(2))
                mode = "opt"
                continue
            if q is None:
                warnings.append(f"p{pno}: orphan line in section {cur_sec['id']}: {text}")
                continue
            if mode == "opt":
                q["options"][-1] += " " + text
            else:
                q["text"] += " " + text
        else:
            _, pno, bbox = it
            if q is None:
                warnings.append(f"p{pno}: orphan image in section {cur_sec and cur_sec['id']}")
                continue
            if q["options"]:
                q.setdefault("image_after_options", True)
            q["images"].append({"page": pno, "bbox": [round(v, 1) for v in bbox]})
    finish()

    sections = [s for s in sections if s["id"] in WANTED_SECTIONS]
    for s in sections:
        for qq in s["questions"]:
            qq["text"] = re.sub(r"\s+", " ", qq["text"]).strip()
            qq["options"] = [re.sub(r"\s+", " ", o).strip() for o in qq["options"]]
            names = []
            for k, im in enumerate(qq["images"]):
                name = f"s{s['id']}_q{qq['number']}" + (f"_{k + 1}" if len(qq["images"]) > 1 else "") + ".jpg"
                pix = doc[im["page"] - 1].get_pixmap(clip=pymupdf.Rect(im["bbox"]), dpi=150)
                pix.save(IMG_DIR / name, jpg_quality=85)
                names.append(name)
            qq["image_files"] = names
    OUT.write_text(json.dumps({"sections": sections}, ensure_ascii=False, indent=1))
    for w in warnings:
        print("WARN", w, file=sys.stderr)
    for s in sections:
        print(s["id"], s["page"], len(s["questions"]), s["title"][:60])


if __name__ == "__main__":
    main()

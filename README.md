# ua-driving-test

Ukrainian theory exam questions (category **B1, B**) with the official answers, as structured data.

## Scope

From `data/raw/questions.pdf`:

- Sections **1–39** (general questions for all categories, pages 1–419)
- Section **44** — «Додаткові питання щодо категорій В1, В (загальні)» (pages 438–442)

Sections for other categories (40–43 A1/A, 45+ B extras, C, D, E, T) are not included.

Answers come from the official answer table `data/raw/Numer_-vidpovidej-do-nakazu.pdf`
(наказ ГСЦ МВС від 29.10.2025 № 225).

## Output

| File | Contents |
|---|---|
| `data/questions.json` | 1,713 questions: `id` (`<section>-<number>`), section, question, options, `correct` (1-based), `correct_text`, image paths, source page |
| `data/questions.csv` | Same data as a flat table (up to 5 option columns) |
| `data/images/` | Question illustrations (`s<section>_q<number>.jpg`) |
| `data/answers/transcription_pass1.txt` | Hand transcription of the scanned answer table |

## How it was built

1. `scripts/parse_questions.py` extracts questions, options and images from the PDF into
   `data/questions_raw.json` + `data/images/`.
2. The answer PDF is a scan, so the table was transcribed by hand into
   `data/answers/transcription_pass1.txt`. Empty table cells are skipped and numbering continues.
3. `scripts/build_dataset.py` merges both and fails if any section's question count differs from
   the answer count, or if any answer is outside the question's option range.

Requires `pymupdf` (`pip install pymupdf`).

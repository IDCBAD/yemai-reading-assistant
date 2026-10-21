"""Build local, letter-sharded English-to-Chinese data from pinned ECDICT.

Only this maintenance script contacts upstream. The extension looks up exact
entries in packaged JSON files. No model or inferred word-root translations
are used to produce these entries.
"""

import argparse
import csv
import hashlib
import io
import json
import re
from pathlib import Path
from urllib.request import urlopen


REVISION = "bc015ed2e24a7abef49fc6dbbb7fe32c1dadaf8b"
SOURCE_SHA256 = "1a6947e04785db63613a92e14903cdae7954f7e84860b10e68e5c7cbb3f9c3cf"
BASE_URL = f"https://raw.githubusercontent.com/skywind3000/ECDICT/{REVISION}/"
FREQUENCY_LIMIT = 40_000
WORD_PATTERN = re.compile(r"[a-z]+(?:[-' ][a-z]+)*")


def normalize(word: str) -> str:
    return word.strip().lower().replace("’", "'").replace("‘", "'")


def download(name: str) -> bytes:
    for attempt in range(3):
        try:
            with urlopen(BASE_URL + name, timeout=60) as response:
                return response.read()
        except Exception:
            if attempt == 2:
                raise
    raise AssertionError("unreachable")


def is_common(row: dict[str, str]) -> bool:
    return bool(row.get("tag")) or any(
        int(row.get(field) or 0) > 0 for field in ("collins", "oxford")
    ) or any(
        0 < int(row.get(field) or 0) <= FREQUENCY_LIMIT for field in ("bnc", "frq")
    )


def short_translation(value: str) -> str:
    # Upstream CSV encodes definition line breaks as the literal characters \n.
    lines = [line.strip() for line in value.replace("\\n", "\n").splitlines() if line.strip()]
    text = "\n".join(lines[:2])
    return text if len(text) <= 240 else text[:239].rstrip() + "…"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, help="Use a previously downloaded, checksum-verified ecdict.csv")
    args = parser.parse_args()
    source = args.source.read_bytes() if args.source else download("ecdict.csv")
    if hashlib.sha256(source).hexdigest() != SOURCE_SHA256:
        raise ValueError("ECDICT data does not match the pinned checksum.")
    rows = list(csv.DictReader(io.StringIO(source.decode("utf-8-sig"), newline="")))
    core = {normalize(row["word"]) for row in rows if is_common(row)}
    entries: dict[str, str] = {}
    for row in rows:
        word = normalize(row["word"])
        # Include only real source rows. Explicit upstream lemma metadata selects
        # common inflections for packaging, but is never used for runtime lookup.
        common_inflection = any(
            item.startswith("0:") and normalize(item[2:]) in core
            for item in row.get("exchange", "").split("/")
        )
        if word not in core and not common_inflection:
            continue
        meaning = short_translation(row["translation"])
        if len(word) <= 80 and WORD_PATTERN.fullmatch(word) and meaning:
            entries.setdefault(word, meaning)

    target = Path(__file__).resolve().parents[1] / "public" / "dictionaries"
    shards_target = target / "en-zh-ecdict"
    shards_target.mkdir(parents=True, exist_ok=True)
    shards = {}
    for letter in "abcdefghijklmnopqrstuvwxyz":
        shard = {word: entries[word] for word in sorted(entries) if word.startswith(letter)}
        raw = (json.dumps(shard, ensure_ascii=False, separators=(",", ":")) + "\n").encode("utf-8")
        (shards_target / f"{letter}.json").write_bytes(raw)
        shards[letter] = {"entries": len(shard), "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}

    metadata = {
        "source": "https://github.com/skywind3000/ECDICT",
        "revision": REVISION,
        "sourceSha256": SOURCE_SHA256,
        "frequencyLimit": FREQUENCY_LIMIT,
        "entries": len(entries),
        "bytes": sum(shard["bytes"] for shard in shards.values()),
        "shards": shards,
    }
    (shards_target / "manifest.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8", newline="\n")
    (target / "ECDICT-README.md").write_bytes(download("README.md"))
    license_text = download("LICENSE").decode("utf-8").strip()
    notice = f"""English-to-Chinese dictionary attribution and license

Bundled files: en-zh-ecdict/a.json through z.json and manifest.json
Source repository: https://github.com/skywind3000/ECDICT
Pinned revision: {REVISION}
Source CSV: {BASE_URL}ecdict.csv
Source CSV SHA-256: {SOURCE_SHA256}
Original upstream documentation: ECDICT-README.md (bundled without modification)
License source: {BASE_URL}LICENSE

This is a derived subset of the community-maintained ECDICT database, not
a claim of authoritative dictionary or context-specific translation quality.
Upstream describes its historical material sources in the bundled README.
The repository distributes this database under its MIT license, reproduced
in full below. No IPA data from ECDICT is bundled by this extraction.

Selection: rows with an exam tag, positive Collins/Oxford marker, or positive
BNC/frq rank <= {FREQUENCY_LIMIT:,}; plus real source rows whose explicit exchange
0: lemma points to one of those selected words. Non-ASCII English headwords,
headwords longer than 80 characters, and empty translations are excluded.
Only lowercase letters with internal apostrophes, spaces or hyphens are kept.
Selection uses source metadata; runtime lookup does not infer lemmas or roots.

Meanings are the first two nonempty translation lines, with surrounding
whitespace removed, limited to 240 characters (ellipsis denotes truncation).
Source part-of-speech labels and wording are retained. These concise general
meanings may not represent the sense used in a particular article.
Lookup misses are expected for rare words, some inflections, names and phrases.

The generated UTF-8 JSON is split by initial letter, loaded only when needed,
and does not make requests to any remote dictionary service at runtime.
Rebuild using scripts/update-word-meaning-dictionary.py.

============================================================================
ECDICT (MIT)
============================================================================

{license_text}
"""
    (target / "ECDICT-NOTICE.txt").write_text(notice, encoding="utf-8", newline="\n")
    print(json.dumps(metadata, indent=2))


if __name__ == "__main__":
    main()

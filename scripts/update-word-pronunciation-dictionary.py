"""Rebuild the pinned, unmodified US IPA dictionary and its redistribution notice.

This maintenance script downloads upstream files. Runtime lookups use only the
packaged dictionary and never contact these sources.
"""

from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from pathlib import Path
from urllib.request import urlopen


IPA_REVISION = "43c3570eb3553bdd19fccd2bd0091534889af023"
DATA_SHA256 = "2af6f154a5c363275f052d1f85acedef38ed185ca9745aa4314be77f6b70de67"
CMUDICT_IPA_REVISION = "629483e9a7fa5b9ff11bb83e3fda6dcc25c5c511"
SYLLABIFY_REVISION = "d816db784436e9de87ec1ef9bd11b8e229853710"
CMUDICT_REVISION = "74790861f652b15e4ac49015a90074ad62a27690"
SOURCES = {
    "data": f"https://raw.githubusercontent.com/open-dict-data/ipa-dict/{IPA_REVISION}/data/en_US.txt",
    "ipa_license": f"https://raw.githubusercontent.com/open-dict-data/ipa-dict/{IPA_REVISION}/LICENSE",
    "cmudict_ipa_license": f"https://raw.githubusercontent.com/lingz/cmudict-ipa/{CMUDICT_IPA_REVISION}/LICENSE",
    "syllabify": f"https://raw.githubusercontent.com/kylebgorman/syllabify/{SYLLABIFY_REVISION}/syllabify.py",
    "cmudict_license": f"https://raw.githubusercontent.com/cmusphinx/cmudict/{CMUDICT_REVISION}/LICENSE",
}


def download(item: tuple[str, str]) -> tuple[str, bytes]:
    key, url = item
    for attempt in range(3):
        try:
            with urlopen(url, timeout=30) as response:
                return key, response.read()
        except Exception:
            if attempt == 2:
                raise
    raise AssertionError("unreachable")


def main() -> None:
    with ThreadPoolExecutor(max_workers=5) as pool:
        files = dict(pool.map(download, SOURCES.items()))
    if sha256(files["data"]).hexdigest() != DATA_SHA256:
        raise ValueError("Upstream dictionary does not match the pinned checksum.")

    syllabify_header = files["syllabify"].decode("utf-8").split("# syllabify.py:", 1)[0]
    syllabify_license = "\n".join(
        line.removeprefix("#").removeprefix(" ")
        for line in syllabify_header.splitlines()
        if not line.startswith("#!")
    ).strip()
    notice = f"""US English IPA dictionary attribution and licenses

Bundled file: en-US-ipa.txt
The data is an unmodified copy of ipa-dict data/en_US.txt (General American).
Repository: https://github.com/open-dict-data/ipa-dict
Revision: {IPA_REVISION}
Source: {SOURCES['data']}
SHA-256: {DATA_SHA256}

ipa-dict's credits identify its US English data as a modified version of
cmudict-ipa by Lingliang Zhang, with stress markers made possible by
syllabify by Kyle Gorman. These upstream attributions and permission notices
are retained below. The CMU Pronouncing Dictionary's source notice is also
included for its underlying pronunciation data. The additional source
revisions below identify the notices reviewed for this distribution; they
do not assert the historical dependency versions used by ipa-dict.

Only en_US.txt is distributed here. No UK pronunciation dataset is included.
The runtime performs local exact lookups; it does not generate transcriptions.

============================================================================
ipa-dict (MIT)
Source: {SOURCES['ipa_license']}
============================================================================

{files['ipa_license'].decode('utf-8').strip()}

============================================================================
cmudict-ipa (MIT)
Repository: https://github.com/lingz/cmudict-ipa
Revision of notice: {CMUDICT_IPA_REVISION}
Source: {SOURCES['cmudict_ipa_license']}
============================================================================

{files['cmudict_ipa_license'].decode('utf-8').strip()}

============================================================================
syllabify (MIT permission notice in syllabify.py)
Repository: https://github.com/kylebgorman/syllabify
Revision of notice: {SYLLABIFY_REVISION}
Source: {SOURCES['syllabify']}
Only its attribution is reproduced; its implementation is not bundled.
============================================================================

{syllabify_license}

============================================================================
CMU Pronouncing Dictionary (source-data attribution)
Repository: https://github.com/cmusphinx/cmudict
Revision of notice: {CMUDICT_REVISION}
Source: {SOURCES['cmudict_license']}
============================================================================

{files['cmudict_license'].decode('utf-8').strip()}
"""
    target = Path(__file__).resolve().parents[1] / "public" / "dictionaries"
    target.mkdir(parents=True, exist_ok=True)
    (target / "en-US-ipa.txt").write_bytes(files["data"])
    (target / "NOTICE.txt").write_text(notice, encoding="utf-8", newline="\n")
    print(f"Wrote {len(files['data']):,} dictionary bytes and NOTICE.txt")


if __name__ == "__main__":
    main()

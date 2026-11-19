#!/usr/bin/env python3
"""Serve a plugin app's build on sample rows, for the site pictures.

The platform's cover_serve.py (lemma-skills/lemma-app-design/scripts) does the
work: it gives the page a placeholder sign-in and answers every API call from
fixture JSON, so nothing can reach real data. This adds one thing it lacks:
file downloads. `GET .../datastore/files/download?path=/x/y.md` is answered
with the raw text of `<fixtures>/documents/y.md`, which is how a plugin app
reads a conversation or a document.

    uv run --no-project python _kit/bin/shots_serve.py --app <dist> --fixtures <dir> --port 4610
"""
import importlib.util
import os
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

# LEMMA_PLATFORM: a checkout of the Lemma platform (it holds lemma-skills).
PLATFORM = os.environ.get("LEMMA_PLATFORM", "")
COVER_SERVE = Path(PLATFORM) / "lemma-skills/lemma-app-design/scripts/cover_serve.py"
if not PLATFORM or not COVER_SERVE.is_file():
    sys.exit("Set LEMMA_PLATFORM to a lemma-platform checkout (it has lemma-skills/lemma-app-design/scripts/cover_serve.py).")
spec = importlib.util.spec_from_file_location("cover_serve", COVER_SERVE)
cover = importlib.util.module_from_spec(spec)
sys.modules["cover_serve"] = cover
spec.loader.exec_module(cover)

base_api = cover.Handler._api


def _api(self, path: str) -> None:
    if path.endswith("datastore/files/download"):
        wanted = (parse_qs(urlsplit(self.path).query).get("path") or [""])[0]
        name = Path(wanted).name
        file = cover.files_under(os.path.join(self.fixtures, "documents")).get(name)
        if file:
            with open(file, "rb") as handle:
                self._send(200, handle.read(), "text/markdown; charset=utf-8")
            return
        cover.say(f"MISS document {wanted}")
        self._send(404, b"", "text/plain")
        return
    base_api(self, path)


cover.Handler._api = _api
sys.exit(cover.main())

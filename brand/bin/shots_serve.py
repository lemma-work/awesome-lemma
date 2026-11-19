#!/usr/bin/env python3
"""Serve the Brand app's build on fixture rows, for the site pictures.

The kit's server (`_kit/bin/shots_serve.py`, on the platform's cover_serve.py)
answers file downloads by file name alone, from `documents/`. Brand reads many
files that share a name (each design version's `index.html` and `theme.css`)
and binary ones (SVG logos), so this answers a download by its whole pod path,
from `<fixtures>/files/<path>`, with the type its extension says. Nothing here
reaches real data: every API call is answered from the fixtures.

    uv run --no-project python bin/shots_serve.py --app apps/brand/source/dist --fixtures .lemma/shots/fixtures --port 4681
"""
import importlib.util
import mimetypes
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
TYPES = {".svg": "image/svg+xml", ".md": "text/markdown; charset=utf-8", ".css": "text/css; charset=utf-8",
         ".html": "text/html; charset=utf-8", ".txt": "text/plain; charset=utf-8"}


def _api(self, path: str) -> None:
    if path.endswith("datastore/files/download"):
        wanted = (parse_qs(urlsplit(self.path).query).get("path") or [""])[0]
        root = Path(self.fixtures, "files").resolve()
        file = (root / wanted.lstrip("/")).resolve()
        if root in file.parents and file.is_file():
            ext = file.suffix.lower()
            self._send(200, file.read_bytes(), TYPES.get(ext) or mimetypes.guess_type(file.name)[0] or "application/octet-stream")
            return
        cover.say(f"MISS file {wanted}")
        self._send(404, b"", "text/plain")
        return
    base_api(self, path)


cover.Handler._api = _api
sys.exit(cover.main())

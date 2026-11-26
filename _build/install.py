#!/usr/bin/env python3
"""Install a plugin into a Lemma the way "Add to your Lemma" does: the
server-side import (upload, plan, apply), which builds every app in the
importer's sandbox. Not `lemma pods import`, which applies from this machine
and upserts.

    uv run --no-project python _build/install.py today --lemma <lemma-id> \
        [--var today_slug=my-today ...] [--plan-only] [--out <dir>]

Uploads `install/<plugin>/` (the committed, assembled bundle) as a zip, or
`--bundle <folder or .zip>` instead (e.g. `_build/out/<plugin>.zip`). --lemma
(or --pod) defaults to LEMMA_POD_ID. It signs in with the `lemma` CLI on PATH (`lemma auth
print-token`, on LEMMA_SERVER when that is set) and talks to that server's API
(`lemma config show`), or to LEMMA_API_URL when that is set.

Prints the plan (each part: CREATE, UPDATE or SKIP) before applying, and the
outcome after, and saves both as JSON under --out (default: the scratch folder
given by TMPDIR) so what the importer did to existing parts can be read.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
API = ""  # set in main(): LEMMA_API_URL, or the CLI's server


def lemma_cli(*args: str) -> str:
    server = ["--server", os.environ["LEMMA_SERVER"]] if os.environ.get("LEMMA_SERVER") else []
    try:
        out = subprocess.run(["lemma", *server, *args], capture_output=True, text=True, check=True)
    except FileNotFoundError:
        raise SystemExit("the lemma CLI is not on PATH (uv tool install lemma-terminal)") from None
    except subprocess.CalledProcessError as exc:
        raise SystemExit(f"lemma {' '.join(args)} failed: {exc.stderr.strip()[-500:]} (signed in? `lemma auth login`)") from None
    return out.stdout


def token() -> str:
    return lemma_cli("auth", "print-token").strip()


def api_url() -> str:
    if os.environ.get("LEMMA_API_URL"):
        return os.environ["LEMMA_API_URL"].rstrip("/")
    config = json.loads(lemma_cli("config", "show", "--json"))
    if not config.get("base_url"):
        raise SystemExit("the CLI names no server URL; set LEMMA_API_URL")
    return str(config["base_url"]).rstrip("/")


def archive_of(plugin: str, bundle: str | None, out: Path) -> Path:
    """The zip to upload: --bundle as given (a .zip, or a folder zipped here), else install/<plugin>/."""
    source = Path(bundle) if bundle else ROOT / "install" / plugin
    if source.is_file() and source.suffix == ".zip":
        return source
    if not (source / "pod.json").is_file():
        raise SystemExit(f"{source} is not a bundle (no pod.json); run _build/assemble.py --install {plugin}")
    target = out / f"{plugin}.zip"
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(source.rglob("*")):
            if path.is_file():
                archive.write(path, str(path.relative_to(source)))
    return target


def call(method: str, path: str, auth: str, body: dict | None = None, raw: bytes | None = None, ctype: str | None = None) -> dict:
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(API + path, data=data, method=method)
    req.add_header("Authorization", f"Bearer {auth}")
    if data is not None:
        req.add_header("Content-Type", ctype or "application/json")
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            text = resp.read().decode()
            return json.loads(text) if text else {}
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"{method} {path} -> {exc.code}: {exc.read().decode()[:2000]}") from None


def upload(pod: str, archive: Path, auth: str) -> str:
    boundary = uuid.uuid4().hex
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"data\"; filename=\"{archive.name}\"\r\n"
            "Content-Type: application/zip\r\n\r\n").encode() + archive.read_bytes() + f"\r\n--{boundary}--\r\n".encode()
    staged = call("POST", f"/pods/{pod}/bundle/uploads", auth, raw=body, ctype=f"multipart/form-data; boundary={boundary}")
    return staged["url"]


def wait(pod: str, import_id: str, auth: str, until: set[str], timeout: float = 1800) -> dict:
    began = time.monotonic()
    last = None
    while time.monotonic() - began < timeout:
        state = call("GET", f"/pods/{pod}/bundle/imports/{import_id}", auth)
        mark = (state.get("status"), (state.get("progress") or {}).get("done"))
        if mark != last:
            print(f"  {state.get('status')} {state.get('progress')}", flush=True)
            last = mark
        if state.get("status") in until:
            return state
        time.sleep(4)
    raise SystemExit(f"import {import_id} did not reach {until} in {timeout} s")


def summary(plan: dict) -> list[str]:
    lines = []
    for step in plan.get("steps") or []:
        detail = step.get("detail") or {}
        extra = ""
        if step.get("kind") == "TABLE" and (detail.get("columns_to_add") or detail.get("columns_to_remove")):
            extra = f" +{detail.get('columns_to_add')} -{detail.get('columns_to_remove')}"
        reason = detail.get("reason") or detail.get("skip_reason") or ""
        lines.append(f"{step.get('kind'):<10} {step.get('name'):<32} {step.get('action'):<8} {step.get('status') or ''}"
                     f"{' destructive' if step.get('destructive') else ''}{extra}{(' · ' + reason) if reason else ''}")
    return lines


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("plugin")
    parser.add_argument("--pod", "--lemma", dest="pod", default=os.environ.get("LEMMA_POD_ID"),
                        help="the Lemma's id (default: LEMMA_POD_ID)")
    parser.add_argument("--bundle", help="a bundle folder or .zip to upload instead of install/<plugin>/")
    parser.add_argument("--var", action="append", default=[], help="name=value for a bundle variable")
    parser.add_argument("--plan-only", action="store_true")
    parser.add_argument("--out", default=os.environ.get("TMPDIR", "/tmp"))
    args = parser.parse_args()
    if not args.pod:
        parser.error("--lemma <lemma-id> (or LEMMA_POD_ID) names the Lemma to install into")
    global API
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    archive = archive_of(args.plugin, args.bundle, out)
    API = api_url()
    auth = token()
    print(f"upload {archive.name} ({archive.stat().st_size // 1024} KiB) to {args.pod}")
    url = upload(args.pod, archive, auth)
    started = call("POST", f"/pods/{args.pod}/bundle/imports", auth, {"kind": "URL", "url": url})
    import_id = started["import_id"]
    print(f"import {import_id}")
    planned = wait(args.pod, import_id, auth, {"AWAITING_CONFIRMATION", "FAILED", "ERROR", "COMPLETED", "EXPIRED"})
    (out / f"{args.plugin}-{args.pod[:8]}-plan.json").write_text(json.dumps(planned, indent=1))
    plan = planned.get("plan") or {}
    print("\n".join(summary(plan)))
    if plan.get("warnings"):
        print("warnings:", json.dumps(plan["warnings"], indent=1))
    if planned.get("status") != "AWAITING_CONFIRMATION":
        print(json.dumps({k: planned.get(k) for k in ("status", "error", "error_code", "warnings")}, indent=1))
        return 1
    if args.plan_only:
        call("DELETE", f"/pods/{args.pod}/bundle/imports/{import_id}", auth)
        print("plan only: cancelled")
        return 0
    variables = dict(v.split("=", 1) for v in args.var)
    for name, spec in (plan.get("variables") or {}).items() if isinstance(plan.get("variables"), dict) else []:
        if name not in variables and isinstance(spec, dict) and spec.get("default") is not None:
            variables[name] = spec["default"]
    # The same connector choices the "Add to your Lemma" page makes: where the
    # organization has no installation of a connector and you may create one,
    # create Lemma's own (`page_defaults` in the platform's plugin_install.py).
    connectors = {
        c["slug"]: {"create_installation": True}
        for c in plan.get("connectors") or []
        if c.get("auth_config_id") is None and c.get("can_create_installation")
        and c.get("status") not in ("EXISTS", "CONFLICT")
    }
    body = {"variables": variables, "connectors": connectors, "confirm_destructive": False}
    print(f"apply with variables {variables}" + (f", installing {sorted(connectors)}" if connectors else ""))
    call("POST", f"/pods/{args.pod}/bundle/imports/{import_id}/apply", auth, body)
    done = wait(args.pod, import_id, auth, {"COMPLETED", "FAILED", "ERROR", "PARTIALLY_APPLIED", "EXPIRED", "CANCELLED"})
    (out / f"{args.plugin}-{args.pod[:8]}-applied.json").write_text(json.dumps(done, indent=1))
    print("\n".join(summary(done.get("plan") or {})))
    print(json.dumps({k: done.get(k) for k in ("status", "error", "error_code", "warnings", "partial_apply")}, indent=1))
    return 0 if done.get("status") == "COMPLETED" else 1


if __name__ == "__main__":
    sys.exit(main())

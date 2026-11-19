#!/usr/bin/env python3
"""Write functions/<name>/<name>.json from a one-line grant spec.

    bin/fnjson.py <name> "<description>" table[:rw|:rwd] ... /folder:read,write,delete connector:<id> [--job]

  table        read the table and its rows
  table:rw     + write rows
  table:rwd    + delete rows. Destructive: `datastore.record.delete` is its own
               permission since the platform split it from write, so a function
               that deletes rows needs it by name or its delete is refused.
  /path:verbs  a folder (a /me path is the invoking person's own area):
               read -> folder.read, write -> folder.write, delete -> folder.delete

Hand-written grant JSON drifted twice in other pods (a `read` without
`datastore.record.read` 403s at runtime); one generator keeps every function's
grants in the same shape. Run it with `uv run --no-project python`.
"""
import json
import sys
from pathlib import Path

FOLDER_VERBS = {"read": "folder.read", "write": "folder.write", "delete": "folder.delete"}

name, desc, *specs = sys.argv[1:]
job = "--job" in specs
grants = []
for spec in (s for s in specs if s != "--job"):
    kind, *rest = spec.split(":")
    if kind == "connector":
        grants.append({"resource_type": "connector", "resource_name": rest[0], "permission_ids": ["connector.use"]})
    elif kind == "function":
        grants.append({"resource_type": "function", "resource_name": rest[0], "permission_ids": ["function.execute"]})
    elif kind.startswith("/"):
        verbs = (rest[0] if rest else "read").split(",")
        unknown = [v for v in verbs if v not in FOLDER_VERBS]
        if unknown:
            sys.exit(f"unknown folder verb(s) {unknown} in {spec}; use read, write, delete")
        grants.append({"resource_type": "folder", "resource_name": kind,
                       "permission_ids": [FOLDER_VERBS[v] for v in verbs]})
    else:
        mode = rest[0] if rest else ""
        if mode not in ("", "rw", "rwd"):
            sys.exit(f"unknown table mode '{mode}' in {spec}; use rw or rwd")
        perms = ["datastore.table.read", "datastore.record.read"]
        if mode in ("rw", "rwd"):
            perms.append("datastore.record.write")
        if mode == "rwd":
            perms.append("datastore.record.delete")
        grants.append({"resource_type": "datastore_table", "resource_name": kind, "permission_ids": perms})
doc = {"name": name, "description": desc, "type": "JOB" if job else "API", "visibility": "POD",
       "code": {"$file": "code.py"}, "permissions": {"grants": grants}}
path = Path(__file__).resolve().parent.parent / "functions" / name / f"{name}.json"
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(json.dumps(doc, indent=2) + "\n")
print(f"wrote {path.relative_to(path.parent.parent.parent)} ({len(grants)} grants)")

#!/usr/bin/env python3
"""Build one installable bundle for a plugin, with every plugin it carries.

A plugin that carries others (Today carries Mail and Meetings) lists them in
its own `plugin.json`:

    { "name": "today", "carries": ["mail", "meetings"] }

This merges each carried plugin from its own folder, bases first and then the
plugin itself, into `_build/out/<plugin>/`: one bundle that installs into an
empty Lemma in one go. Nothing is copied by hand and nothing is written into a
plugin's source. A plugin that carries nothing assembles to itself.

Run from the repository root (standard library only):

    uv run --no-project python _build/assemble.py today
    uv run --no-project python _build/assemble.py today --without-connector googlemeet --zip

    uv run --no-project python _build/assemble.py --install            # every plugin into install/
    uv run --no-project python _build/assemble.py --install people     # one
    uv run --no-project python _build/assemble.py --install --check    # fail if install/ is stale

How parts merge:

- Resources (tables, functions, agents, workflows, schedules, connectors,
  surfaces, apps, files) are copied folder by folder. Two plugins may bring the
  same folder only when it is the same: a shared contract table (byte for byte
  the contract's file, as the lint already requires), or an identical folder.
  Anything else with one name in two plugins is an error.
- A connector two plugins declare (Mail's and Meetings' `outlook`) becomes one:
  same mode, required if either requires it, and both purposes, each naming
  its plugin.
- `pod.json` is the plugin's own (name, description), with the variables of
  every plugin in it; one variable defined two ways is an error.
- Apps are copied from `source/` without node_modules, builds or zips: an
  import builds each app from its source.
- `--without-connector <id>` leaves a connector out, with every grant on it.
  The importer refuses a bundle that declares a connector the organization has
  no installation of, even an optional one, so a bundle for an org without
  Google Meet is assembled without it (as Meetings' bin/import.sh does).

Beside the bundle: `_build/out/<plugin>.assembly.json` says which plugin each
part came from, what was merged or left out, and a hash of every file, which
`_contract/lint.py` compares with a fresh assembly to catch a stale build.

`--install` writes the same assembly into `install/<plugin>/` (with
`install/<plugin>.assembly.json` beside it), the committed folder a Lemma
installs from: "Add to your Lemma" imports it straight from the repository,
and `_build/install.py` uploads it. Every install bundle leaves out the
connectors in INSTALL_WITHOUT. `_contract/lint.py` fails when a bundle in
install/ is not what a fresh assembly makes, or is missing what the
server-side import needs (`install_problems`).
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import sys
import tempfile
import zipfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
CONTRACT = ROOT / "_contract" / "tables"
OUT = HERE / "out"
INSTALL = ROOT / "install"
KIT_APP_FILES = ROOT / "_kit" / "app-files"
# Connectors the bundles in install/ leave out, with every grant on them. The
# importer refuses a bundle that declares a connector the organization has no
# installation of, even one marked "required": false. Google Meet transcripts
# are optional (Meetings falls back to the notes a person writes) and most
# organizations have no googlemeet installation, so install/ goes without it.
INSTALL_WITHOUT = ("googlemeet",)
KINDS =("tables", "functions", "agents", "workflows", "schedules", "connectors", "surfaces", "apps", "files")
SKIP_NAMES = {"node_modules", "dist", ".vite", "__pycache__", ".DS_Store"}
SKIP_SUFFIXES = (".zip", ".tsbuildinfo", ".pyc")


class AssemblyError(Exception):
    pass


def jsonc(text: str):
    """JSON with // and /* */ comments and trailing commas, as bundles allow."""
    out, i, n, in_str = [], 0, len(text), False
    while i < n:
        c = text[i]
        if in_str:
            out.append(c)
            if c == "\\" and i + 1 < n:
                out.append(text[i + 1])
                i += 2
                continue
            if c == '"':
                in_str = False
        elif c == '"':
            in_str = True
            out.append(c)
        elif text.startswith("//", i):
            while i < n and text[i] != "\n":
                i += 1
            continue
        elif text.startswith("/*", i):
            end = text.find("*/", i + 2)
            i = n if end < 0 else end + 2
            continue
        else:
            out.append(c)
        i += 1
    return json.loads(re.sub(r",(\s*[}\]])", r"\1", "".join(out)))


def manifest(plugin: str, root: Path = ROOT) -> dict:
    folder = root / plugin
    if not (folder / "pod.json").is_file():
        raise AssemblyError(f"no plugin '{plugin}' here ({folder} has no pod.json)")
    path = folder / "plugin.json"
    data = jsonc(path.read_text()) if path.is_file() else {}
    carries = data.get("carries") or []
    if not isinstance(carries, list) or not all(isinstance(c, str) for c in carries):
        raise AssemblyError(f"{plugin}/plugin.json: carries must be a list of plugin folder names")
    return {"name": plugin, "carries": carries}


def order(plugin: str, root: Path = ROOT, trail: tuple[str, ...] = ()) -> list[str]:
    """The plugin and everything it carries, bases first, each once."""
    if plugin in trail:
        raise AssemblyError("plugins carry each other in a circle: " + " -> ".join([*trail, plugin]))
    seen: list[str] = []
    for base in manifest(plugin, root)["carries"]:
        for name in order(base, root, (*trail, plugin)):
            if name not in seen:
                seen.append(name)
    seen.append(plugin)
    return seen


def _files(folder: Path) -> list[Path]:
    out = []
    for path in sorted(folder.rglob("*")):
        rel = path.relative_to(folder)
        if any(part in SKIP_NAMES for part in rel.parts) or path.name.endswith(SKIP_SUFFIXES):
            continue
        if path.is_file():
            out.append(path)
    return out


def _tree(folder: Path) -> dict[str, bytes]:
    return {str(p.relative_to(folder)): p.read_bytes() for p in _files(folder)}


def _merge_connector(name: str, sources: list[tuple[str, Path]]) -> bytes:
    specs = [(plugin, jsonc((path / f"{name}.json").read_text())) for plugin, path in sources]
    modes = {s.get("mode") for _, s in specs}
    if len(modes) > 1:
        raise AssemblyError(f"connector '{name}' is declared with different modes: "
                            + ", ".join(f"{p} {s.get('mode')}" for p, s in specs))
    first = dict(specs[0][1])
    first["required"] = any(bool(s.get("required")) for _, s in specs)
    purposes = [f"{jsonc((ROOT / p / 'pod.json').read_text()).get('name') or p}: {s['purpose'].strip()}"
                for p, s in specs if (s.get("purpose") or "").strip()]
    if purposes:
        first["purpose"] = " ".join(purposes)
    return (json.dumps(first, indent=2) + "\n").encode()


def _drop_connector_grants(bundle: Path, connector: str) -> list[str]:
    touched = []
    for kind in ("functions", "agents"):
        for manifest_path in sorted((bundle / kind).glob(f"*/*.json")):
            if manifest_path.stem != manifest_path.parent.name:
                continue
            spec = jsonc(manifest_path.read_text())
            grants = (spec.get("permissions") or {}).get("grants") or []
            kept = [g for g in grants if not (g.get("resource_type") == "connector" and g.get("resource_name") == connector)]
            if len(kept) != len(grants):
                spec["permissions"]["grants"] = kept
                manifest_path.write_text(json.dumps(spec, indent=2) + "\n")
                touched.append(f"{kind}/{manifest_path.parent.name}")
    return touched


def assemble(plugin: str, out_dir: Path, without: tuple[str, ...] = (), root: Path = ROOT) -> dict:
    """Write the bundle into out_dir (emptied first) and return the assembly record."""
    plugins = order(plugin, root)
    contract = {p.stem: p.read_bytes() for p in sorted((root / "_contract" / "tables").glob("*.json"))}
    if out_dir.exists():
        shutil.rmtree(out_dir)
    out_dir.mkdir(parents=True)

    origin: dict[str, list[str]] = {}
    folders: dict[str, list[tuple[str, Path]]] = {}
    for name in plugins:
        for kind in KINDS:
            base = root / name / kind
            if not base.is_dir():
                continue
            for folder in sorted(p for p in base.iterdir() if p.is_dir()):
                key = f"{kind}/{folder.name}"
                folders.setdefault(key, []).append((name, folder))
                origin.setdefault(key, []).append(name)

    merged: dict[str, str] = {}
    for key, sources in sorted(folders.items()):
        kind, rname = key.split("/", 1)
        target = out_dir / key
        if kind == "connectors" and len(sources) > 1:
            target.mkdir(parents=True)
            (target / f"{rname}.json").write_bytes(_merge_connector(rname, sources))
            merged[key] = "one connector, both purposes: " + ", ".join(p for p, _ in sources)
            continue
        trees = [(p, _tree(path)) for p, path in sources]
        if kind == "tables" and rname in contract:
            for p, tree in trees:
                if tree.get(f"{rname}.json") != contract[rname]:
                    raise AssemblyError(f"{p}: tables/{rname}/{rname}.json is not the contract's (run _contract/lint.py --fix)")
        if any(tree != trees[0][1] for _, tree in trees[1:]):
            raise AssemblyError(f"{key} is defined by {', '.join(p for p, _ in sources)} and they differ; "
                                "a name belongs to one plugin, or is a shared table carried exactly")
        for rel, data in trees[0][1].items():
            path = target / rel
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        if len(sources) > 1:
            merged[key] = "identical in " + ", ".join(p for p, _ in sources)

    dropped: dict[str, list[str]] = {}
    for connector in without:
        folder = out_dir / "connectors" / connector
        if folder.is_dir():
            shutil.rmtree(folder)
        dropped[connector] = _drop_connector_grants(out_dir, connector)

    pod = jsonc((root / plugin / "pod.json").read_text())
    variables: dict[str, dict] = {}
    for name in plugins:
        for var, spec in (jsonc((root / name / "pod.json").read_text()).get("variables") or {}).items():
            if var in variables and variables[var] != spec:
                raise AssemblyError(f"variable '{var}' is defined differently by two plugins")
            variables[var] = spec
    pod["format_version"] = max(int(jsonc((root / n / "pod.json").read_text()).get("format_version") or 1) for n in plugins)
    if variables:
        pod["variables"] = variables
    (out_dir / "pod.json").write_text(json.dumps(pod, indent=2) + "\n")

    files = {str(p.relative_to(out_dir)): hashlib.sha256(p.read_bytes()).hexdigest() for p in _files(out_dir)}
    return {
        "plugin": plugin,
        "plugins": plugins,
        "from": {key: where[0] if len(where) == 1 else where for key, where in sorted(origin.items())},
        "merged": merged,
        "without_connectors": dropped,
        "files": files,
        "hash": hashlib.sha256(json.dumps(files, sort_keys=True).encode()).hexdigest(),
    }


# --------------------------------------------------------------------------- checks


def references(bundle: Path) -> list[str]:
    """What an import into an empty Lemma would find missing: every name a part
    uses must be a part of this bundle."""
    have = {kind: {p.name for p in (bundle / kind).iterdir() if p.is_dir()} if (bundle / kind).is_dir() else set()
            for kind in KINDS}
    folders = {"/" + name for name in have["files"]}
    problems: list[str] = []

    def spec(kind: str, name: str) -> dict:
        try:
            return jsonc((bundle / kind / name / f"{name}.json").read_text())
        except (OSError, ValueError) as exc:
            problems.append(f"{kind}/{name}/{name}.json does not read: {exc}")
            return {}

    for name in sorted(have["tables"]):
        for column in spec("tables", name).get("columns") or []:
            target = ((column.get("foreign_key") or {}).get("references") or "").split(".")[0]
            if target and target not in have["tables"]:
                problems.append(f"tables/{name}: column {column.get('name')} references table '{target}', which the bundle lacks")
    for kind in ("functions", "agents"):
        for name in sorted(have[kind]):
            for grant in (spec(kind, name).get("permissions") or {}).get("grants") or []:
                rtype, rname = grant.get("resource_type"), grant.get("resource_name") or ""
                need = {"datastore_table": "tables", "function": "functions", "agent": "agents",
                        "workflow": "workflows", "connector": "connectors"}.get(rtype)
                if need and rname not in have[need]:
                    problems.append(f"{kind}/{name}: grant on {rtype} '{rname}', which the bundle lacks")
                if rtype == "folder" and not rname.startswith("/me") and rname.rstrip("/") not in folders:
                    problems.append(f"{kind}/{name}: grant on folder '{rname}', which the bundle lacks")
    for name in sorted(have["workflows"]):
        wf = spec("workflows", name)
        table = ((wf.get("start") or {}).get("config") or {}).get("table_name")
        if table and table not in have["tables"]:
            problems.append(f"workflows/{name}: starts on table '{table}', which the bundle lacks")
        for node in wf.get("nodes") or []:
            config = node.get("config") or {}
            if node.get("type") == "FUNCTION" and config.get("function_name") not in have["functions"]:
                problems.append(f"workflows/{name}: node {node.get('id')} runs function '{config.get('function_name')}', which the bundle lacks")
            # Every Lemma has its own assistant (pod_default); a bundle never ships it.
            if node.get("type") == "AGENT" and config.get("agent_name") not in have["agents"] | {"pod_default", "POD_DEFAULT"}:
                problems.append(f"workflows/{name}: node {node.get('id')} runs agent '{config.get('agent_name')}', which the bundle lacks")
    starts: dict[str, list[str]] = {}
    for name in sorted(have["schedules"]):
        sc = spec("schedules", name)
        if sc.get("workflow_name"):
            starts.setdefault(sc["workflow_name"], []).append(name)
        if sc.get("workflow_name") and sc["workflow_name"] not in have["workflows"]:
            problems.append(f"schedules/{name}: starts workflow '{sc['workflow_name']}', which the bundle lacks")
        if sc.get("agent_name") and sc["agent_name"] != "POD_DEFAULT" and sc["agent_name"] not in have["agents"]:
            problems.append(f"schedules/{name}: wakes agent '{sc['agent_name']}', which the bundle lacks")
        table = (sc.get("config") or {}).get("table_name")
        if table and table not in have["tables"]:
            problems.append(f"schedules/{name}: watches table '{table}', which the bundle lacks")
    for workflow, names in sorted(starts.items()):
        if len(names) > 1:
            problems.append(f"schedules {', '.join(names)} all start workflow '{workflow}': give each schedule its own workflow "
                            "(the server allows one schedule per workflow, person and Lemma)")
    pod = jsonc((bundle / "pod.json").read_text()) if (bundle / "pod.json").is_file() else {}
    defined = set((pod.get("variables") or {}).keys())
    for name in sorted(have["apps"]):
        text = (bundle / "apps" / name / f"{name}.json").read_text() if (bundle / "apps" / name / f"{name}.json").is_file() else ""
        for var in re.findall(r"\$\{([a-zA-Z0-9_]+)\}", text):
            if var not in defined:
                problems.append(f"apps/{name}: uses variable '{var}', which pod.json does not define")
        if not (bundle / "apps" / name / "source" / "package.json").is_file():
            problems.append(f"apps/{name}: has no source/package.json to build from")
    return problems


def _differs(built: Path, fresh: dict) -> list[str]:
    have = {str(p.relative_to(built)): hashlib.sha256(p.read_bytes()).hexdigest() for p in _files(built)}
    return sorted({k for k in set(have) | set(fresh["files"]) if have.get(k) != fresh["files"].get(k)})


def stale(plugin: str, root: Path = ROOT) -> list[str]:
    """A build in _build/out that a fresh assembly would not produce."""
    record_path = OUT / f"{plugin}.assembly.json"
    built = OUT / plugin
    if not built.is_dir():
        return []
    if not record_path.is_file():
        return [f"_build/out/{plugin} has no {plugin}.assembly.json beside it; re-run _build/assemble.py {plugin}"]
    record = json.loads(record_path.read_text())
    with tempfile.TemporaryDirectory() as tmp:
        fresh = assemble(plugin, Path(tmp) / plugin, tuple(record.get("without_connectors") or ()), root)
    changed = _differs(built, fresh)
    if changed:
        return [f"_build/out/{plugin} is stale ({len(changed)} file(s) differ from its plugins, e.g. {changed[0]}); "
                f"re-run _build/assemble.py {plugin}" + "".join(f" --without-connector {c}" for c in record.get("without_connectors") or ())]
    return []


# --------------------------------------------------------------------------- install/


def plugins(root: Path = ROOT) -> list[str]:
    """Every plugin folder: a folder with a pod.json whose name does not start with _ or ."""
    return sorted(p.name for p in root.iterdir()
                  if p.is_dir() and not p.name.startswith(("_", ".")) and p.name != INSTALL.name and (p / "pod.json").is_file())


def install_without(plugin: str, root: Path = ROOT) -> tuple[str, ...]:
    """The INSTALL_WITHOUT connectors this plugin's assembly would otherwise declare."""
    names = order(plugin, root)
    return tuple(c for c in INSTALL_WITHOUT if any((root / n / "connectors" / c).is_dir() for n in names))


def build_install(plugin: str, root: Path = ROOT, install: Path = INSTALL) -> tuple[dict, list[str]]:
    """Write install/<plugin>/ and its assembly record; return the record and any problems."""
    record = assemble(plugin, install / plugin, install_without(plugin, root), root)
    (install / f"{plugin}.assembly.json").write_text(json.dumps(record, indent=2) + "\n")
    return record, references(install / plugin) + install_ready(install / plugin)


def install_ready(bundle: Path) -> list[str]:
    """What a server-side import of this folder needs and must not get: each app
    builds from source/ with pnpm, so it needs its package.json, every file: dependency
    it names (the vendored kit and SDK tarballs) and the kit's pnpm-workspace.yaml;
    and nothing the server builds anyway or that is never committed."""
    where = f"{bundle.parent.name}/{bundle.name}"
    problems: list[str] = []
    if not (bundle / "pod.json").is_file():
        problems.append(f"{where}: no pod.json")
    for path in sorted(bundle.rglob("*")):
        rel = path.relative_to(bundle)
        if path.name in SKIP_NAMES or path.name.endswith(SKIP_SUFFIXES) or path.name.startswith(".lemma.") or path.suffix == ".log":
            problems.append(f"{where}/{rel}: an install bundle never holds this (a build, a dependency or local state)")
    for package in sorted(bundle.glob("apps/*/source/package.json")):
        source = package.parent
        app = source.parent.name
        try:
            deps = {**(json.loads(package.read_text()).get("dependencies") or {}),
                    **(json.loads(package.read_text()).get("devDependencies") or {})}
        except ValueError as exc:
            problems.append(f"{where}/apps/{app}: package.json does not read: {exc}")
            continue
        for name, spec in sorted(deps.items()):
            if str(spec).startswith("file:") and not (source / str(spec)[len("file:"):]).is_file():
                problems.append(f"{where}/apps/{app}: {name} comes from {spec}, which the bundle lacks")
        if not any(str(spec).startswith("file:vendor/lemma-plugins-kit-") for spec in deps.values()):
            problems.append(f"{where}/apps/{app}: does not take the kit from its vendored tarball")
        for common in sorted(KIT_APP_FILES.glob("*")) if KIT_APP_FILES.is_dir() else []:
            mine = source / common.name
            if not mine.is_file() or mine.read_bytes() != common.read_bytes():
                problems.append(f"{where}/apps/{app}: source/{common.name} is not _kit/app-files/{common.name}; "
                                "the importer's pnpm needs it to build")
    return problems


def install_problems(root: Path = ROOT, install: Path = INSTALL) -> list[str]:
    """install/ holds one current, ready bundle per plugin and nothing else."""
    names = plugins(root)
    problems: list[str] = []
    if not install.is_dir():
        return [f"install/ is missing; run _build/assemble.py --install"]
    for extra in sorted(p.name for p in install.iterdir() if p.is_dir() and p.name not in names):
        problems.append(f"install/{extra} is not a plugin here; remove it")
    for name in names:
        built = install / name
        if not built.is_dir():
            problems.append(f"install/{name} is missing; run _build/assemble.py --install {name}")
            continue
        try:
            with tempfile.TemporaryDirectory() as tmp:
                fresh = assemble(name, Path(tmp) / name, install_without(name, root), root)
        except AssemblyError as exc:
            problems.append(f"install/{name}: does not assemble: {exc}")
            continue
        changed = _differs(built, fresh)
        if changed:
            problems.append(f"install/{name} is stale ({len(changed)} file(s) differ from its plugins, e.g. {changed[0]}); "
                            f"run _build/assemble.py --install {name}")
        record_path = install / f"{name}.assembly.json"
        if not record_path.is_file() or json.loads(record_path.read_text()).get("hash") != fresh["hash"]:
            problems.append(f"install/{name}.assembly.json is missing or stale; run _build/assemble.py --install {name}")
        problems += install_ready(built)
    return problems


def zip_bundle(bundle: Path, target: Path) -> None:
    with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in _files(bundle):
            archive.write(path, str(path.relative_to(bundle)))


def main_install(names: list[str], check: bool) -> int:
    known = plugins()
    unknown = [n for n in names if n not in known]
    if unknown:
        print(f"FAIL  no plugin here named {', '.join(unknown)} (plugins: {', '.join(known)})", file=sys.stderr)
        return 1
    if check:
        problems = install_problems()
        if names:
            problems = [p for p in problems if any(f"install/{n}" in p for n in names)]
        for problem in problems:
            print(f"FAIL  {problem}", file=sys.stderr)
        print("ok    install/ is current" if not problems else f"\n{len(problems)} problem(s) in install/")
        return 1 if problems else 0
    INSTALL.mkdir(exist_ok=True)
    failed = False
    for name in names or known:
        try:
            record, problems = build_install(name)
        except AssemblyError as exc:
            print(f"FAIL  {name}: {exc}", file=sys.stderr)
            failed = True
            continue
        for problem in problems:
            print(f"FAIL  install/{name}: {problem}", file=sys.stderr)
        failed |= bool(problems)
        without = list(record["without_connectors"])
        print(f"{'ok' if not problems else 'built with problems'}    install/{name}: {' + '.join(record['plugins'])}; "
              f"{len(record['files'])} files" + (f"; without {', '.join(without)}" if without else ""))
    return 1 if failed else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("plugin", nargs="*")
    parser.add_argument("--without-connector", action="append", default=[], metavar="ID")
    parser.add_argument("--zip", action="store_true", help="also write _build/out/<plugin>.zip for a server-side import")
    parser.add_argument("--install", action="store_true",
                        help="write install/<plugin>/ for the named plugins (default: every plugin), "
                             "leaving out " + ", ".join(INSTALL_WITHOUT))
    parser.add_argument("--check", action="store_true", help="with --install: write nothing, fail if install/ is stale")
    args = parser.parse_args()
    if args.install:
        if args.without_connector or args.zip:
            parser.error("--install leaves out INSTALL_WITHOUT and writes no zip; use them without --install")
        return main_install(args.plugin, args.check)
    if args.check:
        parser.error("--check goes with --install")
    if len(args.plugin) != 1:
        parser.error("name one plugin (or use --install)")
    args.plugin = args.plugin[0]
    try:
        record = assemble(args.plugin, OUT / args.plugin, tuple(args.without_connector))
    except AssemblyError as exc:
        print(f"FAIL  {exc}", file=sys.stderr)
        return 1
    (OUT / f"{args.plugin}.assembly.json").write_text(json.dumps(record, indent=2) + "\n")
    problems = references(OUT / args.plugin)
    for problem in problems:
        print(f"FAIL  {problem}", file=sys.stderr)
    if args.zip:
        zip_bundle(OUT / args.plugin, OUT / f"{args.plugin}.zip")
    kinds = {}
    for key in record["from"]:
        kinds[key.split("/")[0]] = kinds.get(key.split("/")[0], 0) + 1
    print(f"{'ok' if not problems else 'built with problems'}    _build/out/{args.plugin}: {' + '.join(record['plugins'])}; "
          + ", ".join(f"{n} {k}" for k, n in kinds.items())
          + (f"; without {', '.join(args.without_connector)}" if args.without_connector else "")
          + (f"; zip _build/out/{args.plugin}.zip" if args.zip else ""))
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())

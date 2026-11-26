#!/usr/bin/env python3
"""Check every plugin against the shared contract and against each other.

Run from the repository root (no dependencies beyond the standard library):

    uv run --no-project python _contract/lint.py          # check, exit 1 on any problem
    uv run --no-project python _contract/lint.py --fix    # copy contract tables in, then check

What it checks, plugin by plugin (a plugin is a folder here with a pod.json
that does not start with "_"):

1. Shared tables are carried exactly. A plugin's tables/<name>/<name>.json for
   any table defined in _contract/tables/ must be byte-for-byte the contract's
   file, comments included. Change the contract, then run --fix.
2. A plugin carries its base. Every shared table it touches (a grant, a foreign
   key, a datastore schedule or trigger) must be in its bundle, and so must
   every shared table those reference, so one import into an empty Lemma works.
3. No name is used by two plugins: tables (other than shared ones), functions,
   agents, workflows, schedules and apps, and app public-slug defaults.
4. Bundle hygiene: a resource folder's name equals its "name".
5. Shared questions are asked word for word. Code that reads a conversation
   with the Decisions API embeds _contract/questions/<name>.json between
   `# contract:<name>` and `# end contract`; the embedded object must equal it.
   Shared code works the same way: a writer of needs_you embeds
   _contract/snippets/needs-you.py between the same markers, word for word.
6. One kit. Every app that builds from source depends on the kit as the packed
   tarball in its own source/vendor/, byte-identical to _kit/dist/, and the
   packed kit is current with _kit/src (re-pack with _kit/bin/pack.sh), and it
   carries _kit/app-files/ (pnpm-workspace.yaml) unchanged.
7. Assembled bundles. A plugin whose plugin.json carries other plugins (Today
   carries Mail and Meetings) gets its shared tables from them (rule 2 counts
   what its bases carry), must assemble without a conflict
   (_build/assemble.py), and the assembled bundle must hold every part its
   parts name (functions, agents, tables, workflows, folders, connectors,
   variables), so one install into an empty Lemma works. A build left in
   _build/out/ must be what a fresh assembly makes, or it is stale.
8. A memory block (README, "Memory block"). A plugin tells the Lemma's agents
   it is installed with a block in /memory/AGENTS.md, written by its set-up
   through _contract/snippets/agents-md.py (rule 5 checks the copy). Its text
   lives in its folder: .lemma/agents-block.md (the block's lines, under
   AGENTS_MD_BLOCK_BUDGET with its markers) and .lemma/guide.md (under
   AGENTS_MD_GUIDE_BUDGET, at /memory/plugins/<plugin>.md, named by the
   block), and optionally .lemma/agents-block-me.md (a block for each person's
   /me/AGENTS.md, the same budget). The function that embeds the snippet holds
   them as AGENTS_BLOCK, AGENTS_GUIDE and AGENTS_BLOCK_ME, equal to those
   files (--fix copies them in), calls
   agents_md_write, and has a folder grant on /memory (read, write); the
   plugin carries _contract/files/memory/ exactly, so the grant resolves in an
   empty Lemma, and never a file of its own there. A plugin with no block is a
   warning until MEMORY_BLOCK_REQUIRED is set True, when it fails.

9. One schedule per workflow. The server allows one schedule per workflow,
   person and Lemma (lemma-backend schedule_target_policy.py), so two
   schedules starting one workflow stop the import: give each schedule its own
   workflow. Checked in each plugin and in each assembled bundle.

10. Install bundles are current. install/<plugin>/ is the folder a Lemma
   installs from ("Add to your Lemma" imports it from the repository). Every
   plugin has one, it is exactly what `_build/assemble.py --install` makes now
   (file for file, Google Meet left out), and it holds what the server-side
   import needs (each app's vendored kit and SDK tarballs and the kit's
   pnpm-workspace.yaml) and nothing it must not (node_modules, builds, zips,
   local env files) -- except each app's own prebuilt dist.zip, which must be
   there and stamped with the digest of the app's source, so an install
   deploys it instead of building. Regenerate with `_build/assemble.py --install`.
11. Apps connect their own accounts (`_kit/src/connect.tsx`). No app copy
   sends anyone to the Lemma's connector pages ("the Lemma's connectors",
   "Connectors page", "connect … and come back"); no app does the connecting
   by hand (connect and install requests, sharing an account, binding an
   installation) instead of the kit's `<Connect>`/`useConnection`; and no
   caught error from a connector call reaches the screen as its own text:
   a catch around code that calls `client.connectors` (directly, or through a
   function of the app that does) uses `errorText`/`connectionProblem`, never
   `e.message`, `String(e)` or `${e}`.

It prints every problem it finds, not just the first, then any warnings.
"""

from __future__ import annotations

import ast
import hashlib
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path.cwd()
CONTRACT = ROOT / "_contract" / "tables"
QUESTIONS = ROOT / "_contract" / "questions"
SNIPPETS = ROOT / "_contract" / "snippets"
MEMORY_FOLDER = ROOT / "_contract" / "files" / "memory"
KIT = ROOT / "_kit"
KIT_PACKAGE = "@lemma-plugins/kit"
KINDS = ("tables", "functions", "agents", "workflows", "schedules", "apps")
# 8: a plugin with no memory block is a warning while plugins are being given
# one. Set True once every plugin has .lemma/agents-block.md: then it fails.
MEMORY_BLOCK_REQUIRED = True


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


def plugins() -> list[Path]:
    return sorted(p for p in ROOT.iterdir() if p.is_dir() and not p.name.startswith(("_", ".")) and (p / "pod.json").is_file())


def resources(plugin: Path, kind: str) -> dict[str, dict]:
    found: dict[str, dict] = {}
    base = plugin / kind
    if not base.is_dir():
        return found
    for folder in sorted(base.iterdir()):
        if not folder.is_dir():
            continue
        manifest = folder / f"{folder.name}.json"
        if not manifest.is_file():
            continue
        try:
            found[folder.name] = jsonc(manifest.read_text())
        except ValueError as exc:
            found[folder.name] = {"__error__": str(exc)}
    return found


def contract_tables() -> dict[str, Path]:
    return {p.stem: p for p in sorted(CONTRACT.glob("*.json"))}


def table_refs(spec: dict) -> set[str]:
    refs = set()
    for column in spec.get("columns") or []:
        target = ((column.get("foreign_key") or {}).get("references") or "").split(".")[0]
        if target:
            refs.add(target)
    return refs


def touched_tables(plugin: Path) -> set[str]:
    """Every table a plugin's resources name: grants, foreign keys, triggers."""
    names: set[str] = set()
    for kind in ("functions", "agents"):
        for spec in resources(plugin, kind).values():
            for grant in (spec.get("permissions") or {}).get("grants") or []:
                if grant.get("resource_type") == "datastore_table":
                    names.add(grant.get("resource_name"))
    for spec in resources(plugin, "tables").values():
        names |= table_refs(spec)
    for spec in resources(plugin, "schedules").values():
        table = (spec.get("config") or {}).get("table_name")
        if table:
            names.add(table)
    for spec in resources(plugin, "workflows").values():
        table = ((spec.get("start") or {}).get("config") or {}).get("table_name")
        if table:
            names.add(table)
    return {n for n in names if n}


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def kit_source_hash() -> str:
    digest = hashlib.sha256()
    for path in sorted([KIT / "package.json", KIT / "tsconfig.json", *(KIT / "src").rglob("*")]):
        if path.is_file():
            digest.update(str(path.relative_to(KIT)).encode())
            digest.update(path.read_bytes())
    return digest.hexdigest()


def _assembler():
    import importlib.util

    path = ROOT / "_build" / "assemble.py"
    if not path.is_file():
        return None
    spec = importlib.util.spec_from_file_location("plugin_assemble", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _carried_tables(plugin: Path) -> set[str]:
    """Tables a plugin's bases bring (rule 7); empty for a plugin that carries none."""
    assembler = _assembler()
    if assembler is None or not (plugin / "plugin.json").is_file():
        return set()
    try:
        names = assembler.order(plugin.name, ROOT)[:-1]
    except assembler.AssemblyError:
        return set()
    return set().union(*(set(resources(ROOT / n, "tables")) for n in names)) if names else set()


def assembled_problems() -> list[str]:
    """7: every plugin that carries others assembles, is whole, and is not stale."""
    assembler = _assembler()
    carrying = [p for p in plugins() if (p / "plugin.json").is_file()]
    if not carrying:
        return []
    if assembler is None:
        return [f"{p.name}: carries other plugins, but _build/assemble.py is missing" for p in carrying]
    import tempfile

    problems: list[str] = []
    for plugin in carrying:
        try:
            if not assembler.manifest(plugin.name, ROOT)["carries"]:
                continue
            with tempfile.TemporaryDirectory() as tmp:
                assembler.assemble(plugin.name, Path(tmp) / plugin.name, (), ROOT)
                problems += [f"{plugin.name} (assembled): {p}" for p in assembler.references(Path(tmp) / plugin.name)]
            problems += [f"{plugin.name}: {p}" for p in assembler.stale(plugin.name, ROOT)]
        except assembler.AssemblyError as exc:
            problems.append(f"{plugin.name}: does not assemble: {exc}")
    return problems


def _snippet_number(name: str) -> int | None:
    """A budget from snippets/agents-md.py, so the lint and the code agree."""
    snippet = SNIPPETS / "agents-md.py"
    found = re.search(rf"^{name} = (\d+)$", snippet.read_text(), re.M) if snippet.is_file() else None
    return int(found.group(1)) if found else None


def _tree_bytes(folder: Path) -> dict[str, bytes]:
    if not folder.is_dir():
        return {}
    return {str(p.relative_to(folder)): p.read_bytes() for p in sorted(folder.rglob("*")) if p.is_file() and p.name != ".DS_Store"}


def _py_text(text: str) -> str:
    """A Python literal for `text`, readable when it can be."""
    if '"""' in text or "\\" in text or text.endswith('"'):
        return repr(text)
    return '"""\\\n' + text + '\n"""'


def _rendered(slug: str, body: str) -> str:
    return f"<!-- plugin:{slug} -->\n{body.strip()}\n<!-- /plugin:{slug} -->\n"


def memory_problems(plugin: Path, fix: bool) -> tuple[list[str], list[str]]:
    """8: the plugin's memory block, guide, the function that writes them, and
    the /memory folder it carries. Returns (problems, warnings)."""
    tag, problems, warnings = plugin.name, [], []
    lemma = plugin / ".lemma"
    block_file, guide_file = lemma / "agents-block.md", lemma / "guide.md"
    writers = [c for c in sorted(plugin.glob("functions/*/code.py")) if "# contract:agents-md\n" in c.read_text()]

    carried = plugin / "files" / "memory"
    if carried.exists():
        if _tree_bytes(carried) != _tree_bytes(MEMORY_FOLDER):
            if fix:
                shutil.rmtree(carried)
                shutil.copytree(MEMORY_FOLDER, carried)
                print(f"fixed     {tag}/files/memory from the contract")
            else:
                problems.append(f"{tag}: files/memory/ is not _contract/files/memory/ (run with --fix); "
                                "a plugin never bundles a file into /memory, its set-up writes its block")

    if not block_file.is_file():
        if writers:
            problems.append(f"{tag}: {writers[0].relative_to(plugin)} writes a memory block, but .lemma/agents-block.md is missing")
        else:
            note = (f"{tag}: no memory block (.lemma/agents-block.md), so the Lemma's agents are not told it is "
                    "installed (_contract/README.md, Memory block)")
            (problems if MEMORY_BLOCK_REQUIRED else warnings).append(note)
        return problems, warnings

    slug = tag
    body = block_file.read_text().strip()
    guide = guide_file.read_text().strip() if guide_file.is_file() else None
    guide_path = f"/memory/plugins/{slug}.md"
    budget, guide_budget = _snippet_number("AGENTS_MD_BLOCK_BUDGET"), _snippet_number("AGENTS_MD_GUIDE_BUDGET")
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]*", slug):
        problems.append(f"{tag}: a memory block's marker is the plugin's folder name, which must be lower-case letters, digits and -")
    if re.search(r"<!--\s*/?plugin:", body + (guide or "")):
        problems.append(f"{tag}: .lemma/agents-block.md or guide.md holds a plugin marker; the snippet adds them")
    if not body:
        problems.append(f"{tag}: .lemma/agents-block.md is empty")
    if budget and len(_rendered(slug, body)) > budget:
        problems.append(f"{tag}: the memory block is {len(_rendered(slug, body))} characters with its markers, "
                        f"over the {budget} budget (AGENTS_MD_BLOCK_BUDGET); move detail to .lemma/guide.md")
    if guide is None and guide_path in body:
        problems.append(f"{tag}: the memory block points at {guide_path}, but .lemma/guide.md is missing")
    if guide is not None:
        if guide_path not in body:
            problems.append(f"{tag}: the memory block must name its guide, {guide_path}")
        if guide_budget and len(_rendered(slug, guide)) > guide_budget:
            problems.append(f"{tag}: .lemma/guide.md is over the {guide_budget}-character budget (AGENTS_MD_GUIDE_BUDGET)")
    if not writers:
        problems.append(f"{tag}: has a memory block but no function writes it: embed _contract/snippets/agents-md.py "
                        "in the function its set-up runs, and call agents_md_write")
    if not carried.exists():
        if fix:
            shutil.copytree(MEMORY_FOLDER, carried)
            print(f"fixed     {tag}/files/memory from the contract")
        else:
            problems.append(f"{tag}: writes a memory block but does not carry files/memory/ (run with --fix)")
    # A personal block, for each person's /me/AGENTS.md: the same budget.
    me_file = lemma / "agents-block-me.md"
    me = me_file.read_text().strip() if me_file.is_file() else None
    if me is not None:
        if not me or re.search(r"<!--\s*/?plugin:", me):
            problems.append(f"{tag}: .lemma/agents-block-me.md is empty or holds a plugin marker")
        elif budget and len(_rendered(slug, me)) > budget:
            problems.append(f"{tag}: the personal memory block is {len(_rendered(slug, me))} characters with its "
                            f"markers, over the {budget} budget (AGENTS_MD_BLOCK_BUDGET)")

    sources = {"AGENTS_BLOCK": "agents-block", "AGENTS_GUIDE": "guide", "AGENTS_BLOCK_ME": "agents-block-me"}
    wanted = {"AGENTS_BLOCK": body, "AGENTS_GUIDE": guide, "AGENTS_BLOCK_ME": me}
    for code in writers:
        where = f"{tag}: {code.relative_to(plugin)}"
        text = code.read_text()
        outside = re.sub(r"^# contract:agents-md\n.*?^# end contract$", "", text, flags=re.S | re.M)
        if "agents_md_write(" not in outside:
            problems.append(f"{where} embeds the agents-md snippet but never calls agents_md_write")
        try:
            tree = ast.parse(text)
        except SyntaxError as exc:
            problems.append(f"{where} does not parse: {exc}")
            continue
        assigned = {t.id: node for node in tree.body if isinstance(node, ast.Assign)
                    for t in node.targets if isinstance(t, ast.Name) and t.id in wanted}
        lines, edits = text.splitlines(keepends=True), []
        for name, expected in wanted.items():
            if expected is None:
                continue
            node = assigned.get(name)
            if node is None:
                problems.append(f"{where} does not define {name} (the text of .lemma/{sources[name]}.md)")
                continue
            try:
                value = ast.literal_eval(node.value)
            except ValueError:
                value = None
            if not isinstance(value, str) or value.strip() != expected:
                if fix:
                    edits.append((node.lineno, node.end_lineno, f"{name} = {_py_text(expected)}\n"))
                else:
                    problems.append(f"{where}: {name} differs from .lemma/{sources[name]}.md (run with --fix)")
        for start, end, new in sorted(edits, reverse=True):
            lines[start - 1:end] = [new]
        if edits:
            code.write_text("".join(lines))
            print(f"fixed     {tag}/{code.relative_to(plugin)} from .lemma/")
        spec = resources(plugin, "functions").get(code.parent.name) or {}
        grants = (spec.get("permissions") or {}).get("grants") or []
        if not any(g.get("resource_type") == "folder" and (g.get("resource_name") or "").rstrip("/") == "/memory"
                   and "folder.write" in (g.get("permission_ids") or []) for g in grants):
            problems.append(f"{where}: its function needs a folder grant on /memory (read, write) to write the block")
    return problems, warnings


# 11: apps connect their own accounts, and never show a connector's raw error.
SEND_AWAY = [
    re.compile(r"\bLemma['’]s connectors?\b", re.I),
    re.compile(r"\bconnectors? page\b", re.I),
    re.compile(r"\b(?:in|on|from) (?:the )?connectors\b", re.I),
]
COME_BACK = re.compile(r"\bcome back\b", re.I)
BY_HAND = re.compile(r"\b(createConnectRequest|createInstallRequest|bindAccountInstallation|shareAs|pod\.accounts\.add)\s*\(")
FUNC = re.compile(r"(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(|(?:^|\n)\s*(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*=>")


def _braced(text: str, start: int) -> int:
    """The index just past the block whose `{` is at or after `start`."""
    i = text.find("{", start)
    if i < 0:
        return len(text)
    depth = 0
    quote = None
    while i < len(text):
        ch = text[i]
        if quote:
            if ch == "\\":
                i += 2
                continue
            if ch == quote:
                quote = None
            elif quote == "`" and ch == "$" and text[i + 1:i + 2] == "{":
                depth += 1
                i += 1
        elif ch in "'\"`":
            quote = ch
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return len(text)


def _code_lines(text: str):
    for n, line in enumerate(text.splitlines(), 1):
        bare = line.strip()
        if bare.startswith(("//", "*", "/*")):
            continue
        yield n, line


def connect_problems(plugin: Path) -> list[str]:
    found: list[str] = []
    for src in sorted((plugin / "apps").glob("*/source/src")) if (plugin / "apps").is_dir() else []:
        files = {f: f.read_text() for f in sorted(src.rglob("*.ts*")) if "node_modules" not in f.parts}
        # Functions of this app that reach a connector, and those that call them.
        reach: set[str] = set()
        bodies: dict[str, str] = {}
        for text in files.values():
            for m in FUNC.finditer(text):
                name = m.group(1) or m.group(2)
                bodies[name] = text[m.end():_braced(text, m.end())]
        for _ in range(3):
            for name, body in bodies.items():
                if "connectors." in body or any(re.search(rf"\b{re.escape(r)}\(", body) for r in reach):
                    reach.add(name)
        for f, text in files.items():
            where = f"{plugin.name}: {f.relative_to(plugin)}"
            for n, line in _code_lines(text):
                if any(p.search(line) for p in SEND_AWAY) or (COME_BACK.search(line) and re.search(r"connect", line, re.I)):
                    found.append(f"{where}:{n} sends people to the Lemma's connectors; put the kit's <Connect> here instead")
                if BY_HAND.search(line):
                    found.append(f"{where}:{n} connects by hand ({BY_HAND.search(line).group(1)}); use the kit's <Connect>/useConnection")
            for m in re.finditer(r"\btry\s*\{", text):
                end = _braced(text, m.start())
                body = text[m.start():end]
                catch = re.match(r"\s*catch\s*\((\w+)[^)]*\)\s*", text[end:])
                if not catch:
                    continue
                if "connectors." not in body and not any(re.search(rf"\b{re.escape(r)}\(", body) for r in reach):
                    continue
                var = catch.group(1)
                handler = text[end + catch.end():_braced(text, end + catch.end())]
                if re.search(rf"\b{var}\.message\b|String\({var}\)|\$\{{{var}\}}", handler):
                    line = text[:end].count("\n") + 1
                    found.append(f"{where}:{line} shows a connector call's raw error; say it with errorText({var}) or connectionProblem({var})")
    return found


def main() -> int:
    fix = "--fix" in sys.argv[1:]
    if not CONTRACT.is_dir():
        print("Run this from the repository root: _contract/tables is not here.", file=sys.stderr)
        return 2
    shared = contract_tables()
    shared_specs = {name: jsonc(path.read_text()) for name, path in shared.items()}
    problems: list[str] = []
    warnings: list[str] = []
    owners: dict[tuple[str, str], list[str]] = {}
    slugs: dict[str, list[str]] = {}

    for plugin in plugins():
        tag = plugin.name
        for kind in KINDS:
            for name, spec in resources(plugin, kind).items():
                if "__error__" in spec:
                    problems.append(f"{tag}: {kind}/{name}/{name}.json does not parse: {spec['__error__']}")
                    continue
                if spec.get("name") != name:
                    problems.append(f"{tag}: {kind}/{name} is named {spec.get('name')!r} inside; the folder and the name must match")
                if kind == "tables" and name in shared:
                    continue
                owners.setdefault((kind, name), []).append(tag)

        # 1 + 2: shared tables, carried exactly, with everything they reference.
        carried = set(resources(plugin, "tables"))
        need = {t for t in touched_tables(plugin) if t in shared} | (carried & set(shared))
        frontier = set(need)
        while frontier:
            refs = set().union(*(table_refs(shared_specs[t]) for t in frontier)) & set(shared)
            frontier = refs - need
            need |= refs
        bases = _carried_tables(plugin)
        for name in sorted(need):
            target = plugin / "tables" / name / f"{name}.json"
            if name in bases and not target.is_file():
                continue  # 7: a base it carries brings it.
            if fix and (not target.is_file() or target.read_bytes() != shared[name].read_bytes()):
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(shared[name], target)
                print(f"fixed     {tag}/tables/{name}/{name}.json from the contract")
            if not target.is_file():
                problems.append(f"{tag}: uses shared table '{name}' but does not carry it (run with --fix)")
            elif target.read_bytes() != shared[name].read_bytes():
                problems.append(f"{tag}: tables/{name}/{name}.json differs from _contract/tables/{name}.json (run with --fix)")

        # 9: one schedule per workflow. The server allows one schedule per
        # workflow, person and Lemma, so a second one stops the import.
        starts: dict[str, list[str]] = {}
        for name, spec in resources(plugin, "schedules").items():
            if spec.get("workflow_name"):
                starts.setdefault(spec["workflow_name"], []).append(name)
        for workflow, names in sorted(starts.items()):
            if len(names) > 1:
                problems.append(f"{tag}: schedules {', '.join(sorted(names))} all start workflow '{workflow}': "
                                "give each schedule its own workflow")

        # 3: public slug defaults.
        try:
            pod = jsonc((plugin / "pod.json").read_text())
        except ValueError as exc:
            problems.append(f"{tag}: pod.json does not parse: {exc}")
            pod = {}
        for var, spec in (pod.get("variables") or {}).items():
            if isinstance(spec, dict) and spec.get("type") == "app_slug" and spec.get("default"):
                slugs.setdefault(str(spec["default"]), []).append(f"{tag}:{var}")

        # 5: shared questions, word for word.
        for code in sorted(plugin.glob("functions/*/code.py")):
            text = code.read_text()
            for marker in re.finditer(r"^# contract:([a-z0-9-]+)\n(.*?)^# end contract$", text, re.S | re.M):
                name, body = marker.group(1), marker.group(2)
                spec = QUESTIONS / f"{name}.json"
                where = f"{tag}: {code.relative_to(plugin)}"
                snippet = SNIPPETS / f"{name}.py"
                if not spec.is_file() and snippet.is_file():
                    # Shared code (the needs_you write rule): the same text, word for word.
                    found = re.search(r"^# contract:[a-z0-9-]+\n(.*?)^# end contract$", snippet.read_text(), re.S | re.M)
                    if not found or found.group(1) != body:
                        problems.append(f"{where}: the embedded '{name}' differs from _contract/snippets/{name}.py")
                    continue
                if not spec.is_file():
                    problems.append(f"{where} embeds contract '{name}', which _contract/questions/ does not have")
                    continue
                try:
                    embedded = json.loads(body[body.index("{"): body.rindex("}") + 1])
                except ValueError as exc:
                    problems.append(f"{where}: the embedded '{name}' does not parse: {exc}")
                    continue
                if embedded != json.loads(spec.read_text()):
                    problems.append(f"{where}: the embedded '{name}' differs from _contract/questions/{name}.json")

        # 6: one kit.
        for app in sorted((plugin / "apps").glob("*/source/package.json")) if (plugin / "apps").is_dir() else []:
            source = app.parent
            label = f"{tag}: apps/{source.parent.name}"
            deps = json.loads(app.read_text()).get("dependencies") or {}
            spec = deps.get(KIT_PACKAGE)
            if not spec:
                problems.append(f"{label} does not depend on {KIT_PACKAGE}; every plugin app is drawn with the kit")
                continue
            if not str(spec).startswith("file:vendor/"):
                problems.append(f"{label} takes the kit from {spec!r}; it must be the packed tarball in source/vendor/")
                continue
            for common in sorted((KIT / "app-files").glob("*")) if (KIT / "app-files").is_dir() else []:
                mine = source / common.name
                if not mine.is_file() or mine.read_bytes() != common.read_bytes():
                    problems.append(f"{label}: {common.name} is not _kit/app-files/{common.name} (run _kit/bin/vendor.sh)")
            vendored = source / str(spec)[len("file:"):]
            packed = KIT / "dist" / vendored.name
            if not vendored.is_file():
                problems.append(f"{label}: {vendored.relative_to(ROOT)} is missing (run _kit/bin/vendor.sh)")
            elif not packed.is_file():
                problems.append(f"{label}: uses {vendored.name}, which _kit/dist/ does not have (re-pack or re-vendor)")
            elif sha(vendored) != sha(packed):
                problems.append(f"{label}: {vendored.name} differs from _kit/dist/{vendored.name} (run _kit/bin/vendor.sh)")

        # 11: apps connect their own accounts.
        problems += connect_problems(plugin)

        # 8: a memory block.
        found, warned = memory_problems(plugin, fix)
        problems += found
        warnings += warned

    for (kind, name), where in sorted(owners.items()):
        if len(where) > 1:
            problems.append(f"{kind[:-1]} '{name}' is defined by {', '.join(where)}; names are unique across plugins")
    for slug, where in sorted(slugs.items()):
        if len(where) > 1:
            problems.append(f"app slug default '{slug}' is used by {', '.join(where)}")

    if KIT.is_dir():
        import importlib.util

        loader = importlib.util.spec_from_file_location("contract_types", KIT / "bin" / "contract-types.py")
        if loader and loader.loader:
            module = importlib.util.module_from_spec(loader)
            loader.loader.exec_module(module)
            generated = KIT / "src" / "contract.ts"
            if not generated.is_file() or generated.read_text() != module.render():
                problems.append("_kit/src/contract.ts is not the contract's row types (run _kit/bin/pack.sh)")
        stamp = KIT / "dist" / ".source-hash"
        if not stamp.is_file():
            problems.append("_kit/dist has no packed kit (run _kit/bin/pack.sh)")
        elif stamp.read_text().strip() != kit_source_hash():
            problems.append("_kit/src changed since the kit was packed (run _kit/bin/pack.sh, then _kit/bin/vendor.sh)")

    problems += assembled_problems()

    # 10: install/ is current and ready.
    assembler = _assembler()
    if assembler is not None and hasattr(assembler, "install_problems"):
        problems += assembler.install_problems(ROOT, ROOT / "install")

    names = ", ".join(p.name for p in plugins()) or "none"
    for problem in problems:
        print(f"FAIL  {problem}")
    for warning in warnings:
        print(f"WARN  {warning}")
    if problems:
        print(f"\n{len(problems)} problem(s) across plugins: {names}")
        return 1
    print(f"ok    {len(shared)} shared tables, plugins: {names}"
          + (f" ({len(warnings)} warning(s))" if warnings else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())

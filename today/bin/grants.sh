#!/usr/bin/env bash
# Every function's description and grants, in one place. Regenerates
# functions/<name>/<name>.json; never edit those by hand (bin/fnjson.py, as Mail's).
#   table        read          table:rw   + write rows
# Today reads only the shared needs_you list and its own tables: it carries no
# other plugin, so it is granted nothing of theirs.
set -euo pipefail
cd "$(dirname "$0")/.."
f() { uv run --no-project python bin/fnjson.py "$@"; }
f today_sweep "The morning check: the day in a few lines from the shared needs_you list, kept as the morning note would say it." needs_you today_settings:rw
f today_memory "Tells this Lemma's agents that Today is installed: Today's own block in /memory/AGENTS.md and its guide at /memory/plugins/today.md, leaving the team's notes alone. Each morning check (today-sweep) runs it; safe to run again. remove takes them out." /memory:read,write

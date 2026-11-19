#!/usr/bin/env bash
# Import the bundle into the Lemma bin/lemma is bound to (LEMMA_POD_ID, or --pod <id>).
#
# Google Meet transcripts are optional, but the importer refuses any bundle
# that declares a connector the organization has no installation of, even one
# marked "required": false (lemma-backend pod_bundle/domain/connector_plan.py,
# resolve_connector_choices), and it refuses a grant on a connector the bundle
# does not declare (lemma-cli pod_bundle.py). So when the org has no googlemeet
# installation this imports a staged copy without it: no connectors/googlemeet
# and no googlemeet grant on meetings_due. Everything else is the same, and
# the app offers Meet transcripts only when the Lemma has the connector.
#
#   bin/import.sh [functions/<name>] [--dry-run] [any other `lemma pods import` options]
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
cd "$here"
part="."
if [ $# -gt 0 ] && [ "${1#-}" = "$1" ]; then part="$1"; shift; fi
installed="$(bin/lemma --json connectors auth-configs list 2>/dev/null | uv run --no-project python -c '
import json, sys
d = json.load(sys.stdin)
items = d.get("items", d) if isinstance(d, dict) else d
print("yes" if any(i.get("connector_id") == "googlemeet" for i in items) else "no")')"
if [ "$installed" = "yes" ]; then
  exec bin/lemma pods import "$part" "$@"
fi
stage="$(mktemp -d)/meetings"
mkdir -p "$stage"
# The bundle without node_modules, builds or zips: apps are built from source.
rsync -a --exclude node_modules --exclude dist --exclude '*.zip' --exclude .vite --exclude bin \
  --exclude bench --exclude .lemma --exclude 'connectors/googlemeet' ./ "$stage/"
uv run --no-project python - "$stage/functions/meetings_due/meetings_due.json" <<'PY'
import json, sys
path = sys.argv[1]
doc = json.load(open(path))
doc["permissions"]["grants"] = [g for g in doc["permissions"]["grants"]
                                if not (g["resource_type"] == "connector" and g["resource_name"] == "googlemeet")]
json.dump(doc, open(path, "w"), indent=2)
PY
echo "This org has no googlemeet installation: importing without Google Meet transcripts (staged at $stage)." >&2
cd "$here" && exec bin/lemma pods import "$stage/$part" "$@"

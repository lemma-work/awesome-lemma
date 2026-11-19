#!/usr/bin/env bash
# Hand the packed kit (and the SDK it was built against) to every plugin app.
#
# A bundle import builds each app alone from its own source/ (on this machine
# for `lemma pods import`, in the importer's sandbox for a server-side import),
# so an app cannot reach ../../_kit. It depends on the kit as a tarball in its
# own source/vendor/, the same file byte for byte as _kit/dist/, which the
# contract lint checks. Then each lockfile is refreshed.
#
#   _kit/bin/vendor.sh            every plugin app
#   _kit/bin/vendor.sh mail       one plugin's apps
set -euo pipefail
kit="$(cd "$(dirname "$0")/.." && pwd)"
plugins="$(cd "$kit/.." && pwd)"
major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$major" != "24" ] && [ -x /opt/homebrew/opt/node@24/bin/node ]; then
  export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
fi
tarball="$(ls "$kit"/dist/lemma-plugins-kit-*.tgz | tail -1)"
sdk="$(ls "$kit"/vendor/lemma-sdk-*.tgz | tail -1)"
for source in "$plugins"/*/apps/*/source; do
  plugin="$(basename "$(dirname "$(dirname "$(dirname "$source")")")")"
  case "$plugin" in _*) continue ;; esac
  if [ $# -gt 0 ] && [ "$1" != "$plugin" ]; then continue; fi
  [ -f "$source/package.json" ] || continue
  mkdir -p "$source/vendor"
  find "$source/vendor" -name 'lemma-plugins-kit-*.tgz' -delete
  cp "$tarball" "$sdk" "$source/vendor/"
  # Files every plugin app carries as they are (see _kit/app-files/).
  cp "$kit"/app-files/* "$source/"
  (cd "$source" && node -e '
    const fs = require("fs"); const p = JSON.parse(fs.readFileSync("package.json"));
    p.dependencies = p.dependencies || {};
    p.dependencies["@lemma-plugins/kit"] = "file:vendor/" + process.argv[1];
    p.dependencies["lemma-sdk"] = "file:vendor/" + process.argv[2];
    fs.writeFileSync("package.json", JSON.stringify(p, null, 2) + "\n");
  ' "$(basename "$tarball")" "$(basename "$sdk")")
  (cd "$source" && rm -rf node_modules/@lemma-plugins && npm install --no-audit --no-fund --silent)
  echo "vendored  $(basename "$tarball") -> ${source#"$plugins"/}"
done

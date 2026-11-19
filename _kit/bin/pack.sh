#!/usr/bin/env bash
# Build the kit and pack it: _kit/dist/lemma-plugins-kit-<version>-<hash>.tgz,
# plus .source-hash, which _contract/lint.py compares with src/ to
# catch a kit changed but not re-packed. The tarball's version carries the
# source hash, so a changed kit is a new file and no app's lockfile can keep
# the old one. Then run bin/vendor.sh to hand it to the apps.
set -euo pipefail
cd "$(dirname "$0")/.."
major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$major" != "24" ] && [ -x /opt/homebrew/opt/node@24/bin/node ]; then
  export PATH="/opt/homebrew/opt/node@24/bin:$PATH"
fi
uv run --no-project python bin/contract-types.py
[ -d node_modules ] || npm install --no-audit --no-fund
rm -rf dist && mkdir -p dist
npm run build --silent
# Pack from a staging copy: dist/ is both the build output and where the
# tarball lands, and npm pack would otherwise pack its own earlier tarball.
hash="$(cd .. && uv run --no-project python -c 'import sys; sys.path.insert(0, "_contract"); import lint; print(lint.kit_source_hash())')"
stage="$(mktemp -d)"
node -e '
  const fs = require("fs"); const p = JSON.parse(fs.readFileSync("package.json"));
  p.version = p.version + "-" + process.argv[1].slice(0, 8);
  fs.writeFileSync(process.argv[2] + "/package.json", JSON.stringify(p, null, 2) + "\n");
' "$hash" "$stage"
mkdir -p "$stage/dist" && cp -R dist/. "$stage/dist/"
(cd "$stage" && npm pack --silent --pack-destination "$OLDPWD/dist" >/dev/null)
rm -rf "$stage"
echo "$hash" > dist/.source-hash
ls dist/*.tgz

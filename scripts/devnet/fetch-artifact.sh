#!/usr/bin/env bash
# Downloads the CI artifact named by the frozen devnet manifest into ./artifact and
# verifies it against the manifest. Public files only; no keys are read.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
MANIFEST=deployments/devnet/manifest.json
[ -f "$MANIFEST" ] || { echo "no frozen manifest at $MANIFEST; run git pull" >&2; exit 1; }
run_id="$(node scripts/devnet/manifest.mjs get "$MANIFEST" ci/runId)"
name="$(node scripts/devnet/manifest.mjs get "$MANIFEST" ci/artifactName)"
rm -rf artifact
gh run download "$run_id" --repo "$(node scripts/devnet/manifest.mjs get "$MANIFEST" ci/repository)" -n "$name" -D artifact
(cd artifact && sha256sum -c --quiet SHA256SUMS)
node scripts/devnet/manifest.mjs check-artifact --manifest "$MANIFEST" --artifact-dir artifact

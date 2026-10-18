#!/usr/bin/env bash
# OWNER-RUN. Runs the 16-participant lifecycle against the deployed program twice
# (RR_RUNS to change), each run on a fresh Work, pool, and agreement. Reads only
# the deployer key; expected identities come from the frozen manifest, and the
# initialized ProtocolConfig must match them.
set -euo pipefail

source "$(dirname "$0")/common.sh"
key_matches deployer authorities/deployer
program_files_match
runs="${RR_RUNS:-2}"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"

for run in $(seq 1 "$runs"); do
  echo "=== lifecycle run $run/$runs"
  ANCHOR_PROVIDER_URL="$RPC_URL" \
  ANCHOR_WALLET="$KEY_DIR/deployer.json" \
  RR_EXPECTED_PROGRAM_ID="$(manifest programId)" \
  RR_EXPECTED_UPGRADE_AUTHORITY="$(manifest authorities/upgradeAuthority)" \
  RR_EXPECTED_GOVERNANCE="$(manifest authorities/governance)" \
  RR_EXPECTED_GUARDIAN="$(manifest authorities/guardian)" \
  RR_IDL_PATH="$PROGRAM_DIR/royaltyrail.json" \
  RR_PROGRAM_SO="$PROGRAM_DIR/royaltyrail.so" \
  RR_EVIDENCE_PATH="docs/evidence/$CLUSTER-lifecycle-$stamp-run$run.json" \
  node tests/e2e/devnet-lifecycle.mjs
done
echo "Lifecycle passed $runs times. Commit and push docs/evidence/ (public files only)."

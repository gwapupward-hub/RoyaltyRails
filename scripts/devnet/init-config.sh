#!/usr/bin/env bash
# OWNER-RUN. Initializes the deployment's permanent ProtocolConfig after explicit
# authorization: governance and the upgrade authority both sign, and the stored
# governance, guardian, and token program are verified against the frozen
# manifest. The only step that reads the governance key.
set -euo pipefail

source "$(dirname "$0")/common.sh"
PROGRAM_ID="$(manifest programId)"
GOVERNANCE="$(manifest authorities/governance)"
GUARDIAN="$(manifest authorities/guardian)"
UPGRADE_AUTHORITY="$(manifest authorities/upgradeAuthority)"
key_matches deployer authorities/deployer
key_matches upgrade-authority authorities/upgradeAuthority
key_matches governance authorities/governance
program_files_match

cat <<EOF

Ready to initialize ProtocolConfig on $CLUSTER for program $PROGRAM_ID:
  governance          $GOVERNANCE   (PERMANENT: v1 cannot rotate governance)
  guardian            $GUARDIAN
  co-signer           $UPGRADE_AUTHORITY (current upgrade authority)
  settlement mint     a new six-decimal devnet test mint (deployer is mint authority, no freeze authority)
If ProtocolConfig already exists, it is only verified and nothing is signed.
EOF
authorize "INITIALIZE ${GOVERNANCE: -4}"

ANCHOR_PROVIDER_URL="$RPC_URL" \
ANCHOR_WALLET="$KEY_DIR/deployer.json" \
RR_INIT_ONLY=1 \
RR_EXPECTED_PROGRAM_ID="$PROGRAM_ID" \
RR_EXPECTED_UPGRADE_AUTHORITY="$UPGRADE_AUTHORITY" \
RR_EXPECTED_GOVERNANCE="$GOVERNANCE" \
RR_EXPECTED_GUARDIAN="$GUARDIAN" \
RR_GOVERNANCE_KEYPAIR="$KEY_DIR/governance.json" \
RR_UPGRADE_AUTHORITY_KEYPAIR="$KEY_DIR/upgrade-authority.json" \
RR_IDL_PATH="$PROGRAM_DIR/royaltyrail.json" \
RR_PROGRAM_SO="$PROGRAM_DIR/royaltyrail.so" \
RR_EVIDENCE_PATH="docs/evidence/$CLUSTER-config.json" \
node tests/e2e/devnet-lifecycle.mjs
echo "Next: bash scripts/devnet/run-lifecycle.sh"

#!/usr/bin/env bash
# Runs the 16-participant lifecycle against the deployed program. The first run
# initializes ProtocolConfig, co-signed by the upgrade authority and governance.
# Expected public keys are derived from the key files, so nothing is typed by hand.
set -euo pipefail

KEY_DIR="${RR_KEY_DIR:-$HOME/royaltyrails-devnet}"
RPC_URL="${RR_RPC_URL:-https://api.devnet.solana.com}"
cd "$(git rev-parse --show-toplevel)"
pubkey() { solana-keygen pubkey "$KEY_DIR/$1.json"; }

ANCHOR_PROVIDER_URL="$RPC_URL" \
ANCHOR_WALLET="$KEY_DIR/deployer.json" \
RR_EXPECTED_PROGRAM_ID="$(pubkey program-keypair)" \
RR_EXPECTED_UPGRADE_AUTHORITY="$(pubkey upgrade-authority)" \
RR_EXPECTED_GOVERNANCE="$(pubkey governance)" \
RR_EXPECTED_GUARDIAN="$(pubkey guardian)" \
RR_GOVERNANCE_KEYPAIR="$KEY_DIR/governance.json" \
RR_UPGRADE_AUTHORITY_KEYPAIR="$KEY_DIR/upgrade-authority.json" \
RR_EVIDENCE_PATH="${RR_EVIDENCE_PATH:-docs/evidence/devnet-lifecycle-$(date -u +%Y%m%dT%H%M%SZ).json}" \
node tests/e2e/devnet-lifecycle.mjs

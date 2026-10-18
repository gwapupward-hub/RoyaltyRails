#!/usr/bin/env bash
# OWNER-RUN. Deploys the frozen, CI-built RoyaltyRail artifact with the owner's
# devnet keys after explicit authorization, then verifies the on-chain program,
# upgrade authority, and bytes. Reads only the program, deployer, and
# upgrade-authority keys.
# Usage: scripts/devnet/deploy.sh [artifact directory, default ./artifact from fetch-artifact.sh]
set -euo pipefail

ARTIFACT_DIR="$(realpath "${1:-artifact}")"
[ -d "$ARTIFACT_DIR" ] || { echo "refusing: no artifact at $ARTIFACT_DIR; run scripts/devnet/fetch-artifact.sh" >&2; exit 1; }
source "$(dirname "$0")/common.sh"

PROGRAM_ID="$(manifest programId)"
UPGRADE_AUTHORITY="$(manifest authorities/upgradeAuthority)"
DEPLOYER="$(manifest authorities/deployer)"
SOURCE_COMMIT="$(manifest sourceCommit)"
key_matches program-keypair programId
key_matches deployer authorities/deployer
key_matches upgrade-authority authorities/upgradeAuthority

(cd "$ARTIFACT_DIR" && sha256sum -c --quiet SHA256SUMS) || refuse "artifact files do not match its SHA256SUMS"
node scripts/devnet/manifest.mjs check-artifact --manifest "$MANIFEST" --artifact-dir "$ARTIFACT_DIR"
node scripts/devnet/program-id.mjs check --so "$ARTIFACT_DIR/royaltyrail.so" \
  --idl "$ARTIFACT_DIR/royaltyrail.json" --expect "$PROGRAM_ID" >/dev/null
if solana program show "$PROGRAM_ID" --url "$RPC_URL" >/dev/null 2>&1; then
  refuse "$PROGRAM_ID is already deployed on $CLUSTER; upgrades are a separate, deliberate step"
fi

SO_BYTES=$(wc -c < "$ARTIFACT_DIR/royaltyrail.so")
# ProgramData and the temporary buffer are both rent-funded during deployment.
rent=$(solana rent "$((SO_BYTES + 45))" --lamports --url "$RPC_URL" | grep -oE '[0-9]+' | head -1)
needed=$((rent * 2 + 50000000))
have=$(solana balance "$DEPLOYER" --lamports --url "$RPC_URL" | grep -oE '[0-9]+' | head -1)
[ "$have" -ge "$needed" ] || refuse "deployer $DEPLOYER has $have lamports; needs at least $needed"

cat <<EOF

Ready to deploy RoyaltyRail to $CLUSTER (genesis $GENESIS):
  program ID          $PROGRAM_ID
  upgrade authority   $UPGRADE_AUTHORITY
  deployer            $DEPLOYER (balance $have lamports)
  source commit       $SOURCE_COMMIT
  royaltyrail.so      $(manifest artifacts/royaltyrail.so/sha256) ($SO_BYTES bytes)
  frozen manifest     $MANIFEST ($(sha256sum "$MANIFEST" | cut -c1-64))
EOF
authorize "DEPLOY ${PROGRAM_ID: -4}"

# Output is shown and captured, never written to a file: a failed deploy prints the
# temporary buffer's recovery phrase.
output="$(solana program deploy "$ARTIFACT_DIR/royaltyrail.so" \
  --url "$RPC_URL" \
  --program-id "$KEY_DIR/program-keypair.json" \
  --upgrade-authority "$KEY_DIR/upgrade-authority.json" \
  --keypair "$KEY_DIR/deployer.json" \
  --fee-payer "$KEY_DIR/deployer.json" \
  --commitment confirmed \
  --use-rpc \
  --max-sign-attempts 50 2>&1 | tee /dev/tty)"
SIGNATURE="$(sed -n 's/.*Signature: \([^[:space:]]*\).*/\1/p' <<<"$output" | head -1 || true)"
[ -n "$SIGNATURE" ] || refuse "no deployment signature in the CLI output"

show="$(solana program show "$PROGRAM_ID" --url "$RPC_URL")"
echo "$show"
grep -qE "^Authority: $UPGRADE_AUTHORITY\$" <<<"$show" || refuse "on-chain upgrade authority is not $UPGRADE_AUTHORITY"
PROGRAM_DATA="$(awk '/^ProgramData Address:/ {print $3}' <<<"$show")"
DEPLOY_SLOT="$(awk '/^Last Deployed In Slot:/ {print $5}' <<<"$show")"
dump="$(mktemp)"
solana program dump "$PROGRAM_ID" "$dump" --url "$RPC_URL" >/dev/null
deployed_sha="$(head -c "$SO_BYTES" "$dump" | sha256sum | cut -c1-64)"
tail_nonzero="$(tail -c +"$((SO_BYTES + 1))" "$dump" | tr -d '\0' | wc -c)"
rm -f "$dump"
artifact_sha="$(manifest artifacts/royaltyrail.so/sha256)"
[ "$deployed_sha" = "$artifact_sha" ] && [ "$tail_nonzero" = 0 ] \
  || refuse "deployed bytes ($deployed_sha) differ from the frozen artifact ($artifact_sha)"

mkdir -p "$PROGRAM_DIR" docs/evidence
cp "$ARTIFACT_DIR/royaltyrail.so" "$ARTIFACT_DIR/royaltyrail.json" "$PROGRAM_DIR/"
cat > "docs/evidence/$CLUSTER-deployment.json" <<JSON
{
  "suite": "phase-3d.4-deployment",
  "cluster": "$CLUSTER",
  "genesis": "$GENESIS",
  "programId": "$PROGRAM_ID",
  "programData": "$PROGRAM_DATA",
  "deploySlot": $DEPLOY_SLOT,
  "deploySignature": "$SIGNATURE",
  "upgradeAuthority": "$UPGRADE_AUTHORITY",
  "deployer": "$DEPLOYER",
  "sourceCommit": "$SOURCE_COMMIT",
  "manifestSha256": "$(sha256sum "$MANIFEST" | cut -c1-64)",
  "programSha256": "$artifact_sha",
  "deployedProgramSha256": "$deployed_sha",
  "idlSha256": "$(manifest artifacts/royaltyrail.json/sha256)",
  "programBytes": $SO_BYTES
}
JSON
echo "Deployed and verified. Public record: docs/evidence/$CLUSTER-deployment.json"
echo "Next: bash scripts/devnet/init-config.sh"

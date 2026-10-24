#!/usr/bin/env bash
# OWNER-RUN. Upgrades the already-deployed devnet program in place: same program ID,
# same upgrade authority. Deploys only a CI-built artifact that the committed manifest
# describes exactly, after explicit authorization, then verifies the on-chain bytes.
# The manifest must already name this artifact's commit (check-artifact enforces it),
# so an upgrade cannot run against a stale or unrecorded build.
# Usage: scripts/devnet/upgrade.sh [artifact directory, default ./artifact]
set -euo pipefail

ARTIFACT_DIR="$(realpath "${1:-artifact}")"
[ -d "$ARTIFACT_DIR" ] || { echo "refusing: no artifact at $ARTIFACT_DIR" >&2; exit 1; }
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

show="$(solana program show "$PROGRAM_ID" --url "$RPC_URL" 2>/dev/null)" \
  || refuse "$PROGRAM_ID is not deployed on $CLUSTER; use deploy.sh for the first deployment"
grep -qE "^Authority: $UPGRADE_AUTHORITY\$" <<<"$show" || refuse "on-chain upgrade authority is not $UPGRADE_AUTHORITY"

SO_BYTES=$(wc -c < "$ARTIFACT_DIR/royaltyrail.so")
artifact_sha="$(manifest artifacts/royaltyrail.so/sha256)"

# Refuse a no-op upgrade: the program already runs exactly this build.
before_dump="$(mktemp)"
solana program dump "$PROGRAM_ID" "$before_dump" --url "$RPC_URL" >/dev/null
previous_sha="$(head -c "$SO_BYTES" "$before_dump" | sha256sum | cut -c1-64)"
rm -f "$before_dump"
[ "$previous_sha" != "$artifact_sha" ] || refuse "$PROGRAM_ID already runs this build ($artifact_sha); nothing to upgrade"

cat <<EOF

Ready to UPGRADE RoyaltyRail on $CLUSTER (genesis $GENESIS):
  program ID          $PROGRAM_ID
  upgrade authority   $UPGRADE_AUTHORITY
  deployer            $DEPLOYER
  running now         $previous_sha
  new build           $artifact_sha ($SO_BYTES bytes)
  source commit       $SOURCE_COMMIT
  manifest            $MANIFEST ($(sha256sum "$MANIFEST" | cut -c1-64))
EOF
authorize "UPGRADE ${PROGRAM_ID: -4}"

# Output is shown and captured, never written to a file: a failed upgrade prints the
# temporary buffer's recovery phrase. A larger binary than the current ProgramData fails
# here without changing the program; extend it first with the Solana CLI.
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
[ -n "$SIGNATURE" ] || refuse "no upgrade signature in the CLI output"

show="$(solana program show "$PROGRAM_ID" --url "$RPC_URL")"
echo "$show"
grep -qE "^Authority: $UPGRADE_AUTHORITY\$" <<<"$show" || refuse "on-chain upgrade authority changed to something other than $UPGRADE_AUTHORITY"
PROGRAM_DATA="$(awk '/^ProgramData Address:/ {print $3}' <<<"$show")"
DEPLOY_SLOT="$(awk '/^Last Deployed In Slot:/ {print $5}' <<<"$show")"
dump="$(mktemp)"
solana program dump "$PROGRAM_ID" "$dump" --url "$RPC_URL" >/dev/null
deployed_sha="$(head -c "$SO_BYTES" "$dump" | sha256sum | cut -c1-64)"
tail_nonzero="$(tail -c +"$((SO_BYTES + 1))" "$dump" | tr -d '\0' | wc -c)"
rm -f "$dump"
[ "$deployed_sha" = "$artifact_sha" ] && [ "$tail_nonzero" = 0 ] \
  || refuse "upgraded bytes ($deployed_sha) differ from the new build ($artifact_sha)"

mkdir -p "$PROGRAM_DIR" docs/evidence
cp "$ARTIFACT_DIR/royaltyrail.so" "$ARTIFACT_DIR/royaltyrail.json" "$PROGRAM_DIR/"
EVIDENCE="docs/evidence/$CLUSTER-upgrade-$(date -u +%Y%m%dT%H%M%SZ).json"
cat > "$EVIDENCE" <<JSON
{
  "suite": "devnet-upgrade",
  "cluster": "$CLUSTER",
  "genesis": "$GENESIS",
  "programId": "$PROGRAM_ID",
  "programData": "$PROGRAM_DATA",
  "upgradeSlot": $DEPLOY_SLOT,
  "upgradeSignature": "$SIGNATURE",
  "upgradeAuthority": "$UPGRADE_AUTHORITY",
  "deployer": "$DEPLOYER",
  "sourceCommit": "$SOURCE_COMMIT",
  "manifestSha256": "$(sha256sum "$MANIFEST" | cut -c1-64)",
  "previousProgramSha256": "$previous_sha",
  "programSha256": "$artifact_sha",
  "deployedProgramSha256": "$deployed_sha",
  "programBytes": $SO_BYTES
}
JSON
echo "Upgraded and verified. Public record: $EVIDENCE"
echo "Next: commit the evidence file; the program ID, upgrade authority, and config are unchanged."

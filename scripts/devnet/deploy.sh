#!/usr/bin/env bash
# Deploys the CI-built RoyaltyRail artifact with the owner's devnet keys, then
# verifies the on-chain upgrade authority and program bytes.
# Usage: scripts/devnet/deploy.sh <downloaded artifact directory>
set -euo pipefail

ARTIFACT_DIR="${1:?usage: scripts/devnet/deploy.sh <artifact directory>}"
KEY_DIR="${RR_KEY_DIR:-$HOME/royaltyrails-devnet}"
RPC_URL="${RR_RPC_URL:-https://api.devnet.solana.com}"
DEVNET_GENESIS=EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG
fail() { echo "refusing: $*" >&2; exit 1; }

cd "$(git rev-parse --show-toplevel)"
genesis="$(solana genesis-hash --url "$RPC_URL")"
case "$RPC_URL" in
  http://127.0.0.1:*|http://localhost:*) echo "localnet rehearsal ($genesis)" ;;
  *) [ "$genesis" = "$DEVNET_GENESIS" ] || fail "$RPC_URL is not devnet (genesis $genesis)" ;;
esac

for name in program-keypair deployer upgrade-authority; do
  [ -f "$KEY_DIR/$name.json" ] || fail "missing $KEY_DIR/$name.json"
done
PROGRAM_ID="$(solana-keygen pubkey "$KEY_DIR/program-keypair.json")"
UPGRADE_AUTHORITY="$(solana-keygen pubkey "$KEY_DIR/upgrade-authority.json")"
DEPLOYER="$(solana-keygen pubkey "$KEY_DIR/deployer.json")"

(cd "$ARTIFACT_DIR" && sha256sum -c SHA256SUMS) || fail "artifact checksums do not match"
grep -qF "declare_id!(\"$PROGRAM_ID\")" "$ARTIFACT_DIR/BUILD_INFO" \
  || fail "artifact was not built for program ID $PROGRAM_ID"
SOURCE_COMMIT="$(cat "$ARTIFACT_DIR/SOURCE_COMMIT")"
git cat-file -e "$SOURCE_COMMIT^{commit}" 2>/dev/null || fail "source commit $SOURCE_COMMIT is not in this checkout (git fetch)"
# The checkout may be newer (docs/tests), but the program build inputs must be identical.
git diff --quiet "$SOURCE_COMMIT" HEAD -- programs crates Cargo.toml Cargo.lock rust-toolchain.toml \
  || fail "program sources differ from the artifact's source commit $SOURCE_COMMIT"
if solana program show "$PROGRAM_ID" --url "$RPC_URL" >/dev/null 2>&1; then
  fail "$PROGRAM_ID is already deployed; upgrades are a separate, deliberate step"
fi

SO_BYTES=$(wc -c < "$ARTIFACT_DIR/royaltyrail.so")
# ProgramData and the temporary buffer are both rent-funded during deployment.
rent=$(solana rent "$((SO_BYTES + 45))" --lamports --url "$RPC_URL" | grep -oE '[0-9]+' | head -1)
needed=$((rent * 2 + 50000000))
have=$(solana balance "$DEPLOYER" --lamports --url "$RPC_URL" | grep -oE '[0-9]+' | head -1)
[ "$have" -ge "$needed" ] || fail "deployer $DEPLOYER has $have lamports; needs at least $needed"

echo "Deploying $PROGRAM_ID (upgrade authority $UPGRADE_AUTHORITY, deployer $DEPLOYER)"
solana program deploy "$ARTIFACT_DIR/royaltyrail.so" \
  --url "$RPC_URL" \
  --program-id "$KEY_DIR/program-keypair.json" \
  --upgrade-authority "$KEY_DIR/upgrade-authority.json" \
  --keypair "$KEY_DIR/deployer.json" \
  --fee-payer "$KEY_DIR/deployer.json" \
  --commitment confirmed \
  --use-rpc \
  --max-sign-attempts 50 | tee /tmp/royaltyrail-deploy.txt
SIGNATURE="$(grep -oE 'Signature: [1-9A-HJ-NP-Za-km-z]+' /tmp/royaltyrail-deploy.txt | awk '{print $2}' || true)"

show="$(solana program show "$PROGRAM_ID" --url "$RPC_URL")"
echo "$show"
echo "$show" | grep -qE "Authority: $UPGRADE_AUTHORITY\$" || fail "on-chain upgrade authority is not $UPGRADE_AUTHORITY"
solana program dump "$PROGRAM_ID" /tmp/royaltyrail-deployed.so --url "$RPC_URL" >/dev/null
deployed_sha="$(head -c "$SO_BYTES" /tmp/royaltyrail-deployed.so | sha256sum | awk '{print $1}')"
artifact_sha="$(sha256sum "$ARTIFACT_DIR/royaltyrail.so" | awk '{print $1}')"
[ "$deployed_sha" = "$artifact_sha" ] || fail "deployed bytes ($deployed_sha) differ from the artifact ($artifact_sha)"

mkdir -p target/deploy target/idl docs/evidence
cp "$ARTIFACT_DIR/royaltyrail.so" target/deploy/royaltyrail.so
cp "$ARTIFACT_DIR/royaltyrail.json" target/idl/royaltyrail.json
cat > docs/evidence/devnet-deployment.json <<JSON
{
  "programId": "$PROGRAM_ID",
  "genesis": "$genesis",
  "deploySignature": "$SIGNATURE",
  "upgradeAuthority": "$UPGRADE_AUTHORITY",
  "deployer": "$DEPLOYER",
  "sourceCommit": "$SOURCE_COMMIT",
  "programSha256": "$artifact_sha",
  "idlSha256": "$(sha256sum "$ARTIFACT_DIR/royaltyrail.json" | awk '{print $1}')",
  "programBytes": $SO_BYTES
}
JSON
echo "Deployed and verified. Public record: docs/evidence/devnet-deployment.json"

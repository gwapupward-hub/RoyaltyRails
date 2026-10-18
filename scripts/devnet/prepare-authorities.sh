#!/usr/bin/env bash
# PUBLIC-ONLY. Freeze the five devnet role addresses and sync the program ID.
# This script never reads, creates, or accepts a private key or seed phrase.
# Usage:
#   scripts/devnet/prepare-authorities.sh \
#     <program-id> <deployer> <upgrade-authority> <governance> <guardian>
set -euo pipefail

refuse() { echo "refusing: $*" >&2; exit 1; }
[ "$#" -eq 5 ] || refuse "expected exactly five public addresses"
[ -z "${CLAUDECODE:-}" ] || refuse "run this public-record step in the owner's shell, not an agent shell"
[ -z "${GITHUB_ACTIONS:-}" ] && [ -z "${CI:-}" ] || refuse "identity records are prepared outside CI"

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"
out="deployments/devnet/authorities.json"
[ ! -e "$out" ] || refuse "$out already exists; public identity is immutable for this deployment"

program_id="$1"
deployer="$2"
upgrade_authority="$3"
governance="$4"
guardian="$5"

# Let the repository's Node-only validator enforce base58/32-byte format and
# distinctness. The temporary file is public data only and is removed on exit.
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
umask 022
cat > "$tmp" <<JSON
{
  "cluster": "devnet",
  "genesisHash": "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  "programId": "$program_id",
  "deployer": "$deployer",
  "upgradeAuthority": "$upgrade_authority",
  "governance": "$governance",
  "guardian": "$guardian"
}
JSON

mkdir -p deployments/devnet
node scripts/devnet/program-id.mjs sync "$tmp" >/dev/null
mv -n "$tmp" "$out"
trap - EXIT
chmod 644 "$out"
printf 'Wrote public authority record: %s\n' "$out"
printf 'Private keys were not read or written.\n'

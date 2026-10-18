#!/usr/bin/env bash
# Generates the five DEVNET-ONLY RoyaltyRail keys outside the repository.
# Each seed phrase is printed once: write the upgrade-authority, governance,
# and guardian phrases on paper. Never share a private key or seed phrase.
set -euo pipefail

KEY_DIR="${RR_KEY_DIR:-$HOME/royaltyrails-devnet}"
KEYS=(program-keypair deployer upgrade-authority governance guardian)

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
key_dir_abs="$(realpath -m "$KEY_DIR")"
if [ -n "$repo_root" ] && [[ "$key_dir_abs/" == "$repo_root/"* ]]; then
  echo "refusing: $key_dir_abs is inside the repository" >&2
  exit 1
fi
mkdir -p "$key_dir_abs"
chmod 700 "$key_dir_abs"
umask 077

for name in "${KEYS[@]}"; do
  if [ -e "$key_dir_abs/$name.json" ]; then
    echo "refusing: $key_dir_abs/$name.json already exists (keys are never overwritten)" >&2
    exit 1
  fi
done

for name in "${KEYS[@]}"; do
  echo
  echo "=== $name (DEVNET ONLY) ==="
  solana-keygen new --word-count 12 --no-bip39-passphrase --outfile "$key_dir_abs/$name.json"
done

echo
echo "Public keys to share (safe to send; never send the .json files or seed phrases):"
for name in "${KEYS[@]}"; do
  printf '%-18s %s\n' "$name" "$(solana-keygen pubkey "$key_dir_abs/$name.json")"
done

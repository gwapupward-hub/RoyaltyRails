#!/usr/bin/env bash
# OWNER-ONLY. Generates the five DEVNET-ONLY RoyaltyRail keys in the owner's own
# terminal, outside the repository, verifies the paper backups of the three keys
# with lasting power, and prints and records public keys only (plus the public
# program-ID sync of declare_id! and Anchor.toml).
#
# Seed phrases appear only on the terminal's alternate screen, which keeps them
# out of the scrollback, and are never written to disk, logs, or the repository.
# Backups are verified with `solana-keygen pubkey ASK`, the same derivation as
# `solana-keygen new` and `solana-keygen recover`. (`prompt://` derives a
# different key from the same words and must not be used for these keys.)
set -euo pipefail
umask 077

KEY_DIR="${RR_KEY_DIR:-$HOME/royaltyrails-devnet}"
DEVNET_GENESIS=EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG
# The program keypair is only needed until the first deploy, and the deployer only
# holds devnet SOL, so neither seed phrase is shown. The other three keep power.
UNBACKED_KEYS=(program-keypair deployer)
BACKED_UP_KEYS=(upgrade-authority governance guardian)
ALL_KEYS=("${UNBACKED_KEYS[@]}" "${BACKED_UP_KEYS[@]}")
refuse() { echo "refusing: $*" >&2; exit 1; }

# Accident guards, not a security boundary: keys belong in the owner's own shell.
[ -z "${CLAUDECODE:-}" ] || refuse "this shell is run by an AI agent; generate keys in your own Codespace terminal"
[ -z "${GITHUB_ACTIONS:-}" ] && [ -z "${CI:-}" ] || refuse "this is a CI environment; only the owner generates keys"
[ -t 0 ] && [ -t 1 ] || refuse "run this in an interactive terminal"
solana-keygen --version 2>/dev/null | grep -qF "solana-keygen 4.1.2 " \
  || refuse "solana-keygen 4.1.2 not found; run scripts/devnet/codespace-setup.sh, then source ~/.bashrc"

repo_root="$(git rev-parse --show-toplevel 2>/dev/null || true)"
key_dir="$(realpath -m "$KEY_DIR")"
if [ -n "$repo_root" ] && [[ "$key_dir/" == "$repo_root/"* ]]; then
  refuse "$key_dir is inside the repository"
fi
authorities="${repo_root:+$repo_root/deployments/devnet/authorities.json}"
if [ -n "$authorities" ] && [ -e "$authorities" ]; then
  refuse "a devnet identity is already recorded in deployments/devnet/authorities.json"
fi
for name in "${ALL_KEYS[@]}"; do
  [ ! -e "$key_dir/$name.json" ] || refuse "$key_dir/$name.json already exists (keys are never overwritten)"
done
mkdir -p "$key_dir"
chmod 700 "$key_dir"
staging="$key_dir/.staging"
# Leftovers of an interrupted run were never verified or shared: discard them.
rm -rf "$staging"
mkdir -m 700 "$staging"

alt_screen=0
leave_alt_screen() {
  if [ "$alt_screen" = 1 ]; then printf '\033[2J\033[?1049l'; alt_screen=0; fi
}
trap 'leave_alt_screen; rm -rf "$staging"' EXIT

for name in "${UNBACKED_KEYS[@]}"; do
  solana-keygen new --no-bip39-passphrase --word-count 12 --silent --outfile "$staging/$name.json" >/dev/null
done

for name in "${BACKED_UP_KEYS[@]}"; do
  file="$staging/$name.json"
  verified=0
  for round in 1 2 3; do
    rm -f "$file"
    printf '\033[?1049h\033[H\033[2J'
    alt_screen=1
    echo "RoyaltyRails DEVNET-ONLY key: $name"
    echo "Write the 12 words below on paper, in order."
    echo "No screenshot, no copy and paste, no notes app."
    echo
    solana-keygen new --no-bip39-passphrase --word-count 12 --outfile "$file" | sed -n '/^Save this seed phrase/,$p'
    echo
    read -rp "Press Enter once the words are on paper. The screen will be cleared. " _ </dev/tty
    leave_alt_screen
    expected="$(solana-keygen pubkey "$file")"
    for try in 1 2 3; do
      echo
      echo "Verify the $name backup ($try/3): type the 12 words from your paper."
      echo "Input is hidden. Separate words with single spaces. Press Enter at the passphrase prompt."
      if got="$(solana-keygen pubkey ASK 2>/dev/null)" && [ "$got" = "$expected" ]; then
        verified=1
        echo "$name backup verified."
        break
      fi
      echo "That does not recover the $name key."
    done
    [ "$verified" = 1 ] && break
    [ "$round" -lt 3 ] || break
    echo "The $name backup could not be verified. Discarding this key; a new one will be shown (round $((round + 1))/3)."
    read -rp "Cross out the old words, then press Enter. " _ </dev/tty
  done
  [ "$verified" = 1 ] || refuse "the $name backup could not be verified; no keys were kept"
done

declare -A pub
for name in "${ALL_KEYS[@]}"; do pub[$name]="$(solana-keygen pubkey "$staging/$name.json")"; done
[ "$(printf '%s\n' "${pub[@]}" | sort -u | wc -l)" = "${#ALL_KEYS[@]}" ] || refuse "generated keys are not distinct"

for name in "${ALL_KEYS[@]}"; do
  mv -n "$staging/$name.json" "$key_dir/$name.json"
  [ ! -e "$staging/$name.json" ] || refuse "$key_dir/$name.json appeared during generation; not overwritten"
  chmod 600 "$key_dir/$name.json"
done

public_json="$(cat <<JSON
{
  "cluster": "devnet",
  "genesisHash": "$DEVNET_GENESIS",
  "programId": "${pub[program-keypair]}",
  "deployer": "${pub[deployer]}",
  "upgradeAuthority": "${pub[upgrade-authority]}",
  "governance": "${pub[governance]}",
  "guardian": "${pub[guardian]}"
}
JSON
)"
echo "$public_json" > "$key_dir/public-keys.json"
if [ -n "$authorities" ]; then
  mkdir -p "$(dirname "$authorities")"
  (umask 022 && echo "$public_json" > "$authorities")
  # Public program-ID sync (declare_id! and Anchor.toml), so the pushed commit builds the deployable artifact.
  (cd "$repo_root" && umask 022 && node scripts/devnet/program-id.mjs sync deployments/devnet/authorities.json)
fi

echo
echo "Keys saved in $key_dir (owner-only permissions). Public keys, safe to share:"
printf '  %-18s %s\n' \
  program-id "${pub[program-keypair]}" \
  deployer "${pub[deployer]}" \
  upgrade-authority "${pub[upgrade-authority]}" \
  governance "${pub[governance]}" \
  guardian "${pub[guardian]}"
if [ -n "$authorities" ]; then
  echo
  echo "Recorded in deployments/devnet/authorities.json, with the program ID synced into the source."
  echo "Share them by pushing only these three public files:"
  echo "  git add deployments/devnet/authorities.json programs/royaltyrail/src/lib.rs Anchor.toml"
  echo "  git commit -m 'chore: freeze devnet program identity' && git push"
  echo "or paste the five lines above to Claude. Never share a .json key file or a seed phrase."
fi

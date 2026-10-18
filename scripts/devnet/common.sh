# Shared guards for the owner-run devnet scripts. Sourced, not executed.
#
# Every script that touches a key: targets devnet (or a local validator for a
# rehearsal) by genesis hash, reads expected public keys only from the frozen,
# committed manifest, and on devnet refuses to run in an AI-agent or CI shell.

KEY_DIR="${RR_KEY_DIR:-$HOME/royaltyrails-devnet}"
RPC_URL="${RR_RPC_URL:-https://api.devnet.solana.com}"
DEVNET_GENESIS=EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG
MANIFEST="${RR_MANIFEST:-deployments/devnet/manifest.json}"
PROGRAM_DIR=target/devnet
refuse() { echo "refusing: $*" >&2; exit 1; }

cd "$(git rev-parse --show-toplevel)"
solana --version 2>/dev/null | grep -qF "solana-cli 4.1.2 " \
  || refuse "solana-cli 4.1.2 not found; run scripts/devnet/codespace-setup.sh, then source ~/.bashrc"

GENESIS="$(solana genesis-hash --url "$RPC_URL")" || refuse "cannot reach $RPC_URL"
case "$RPC_URL" in
  http://127.0.0.1:*|http://localhost:*) CLUSTER=localnet ;;
  *)
    [ "$GENESIS" = "$DEVNET_GENESIS" ] || refuse "$RPC_URL is not devnet (genesis $GENESIS)"
    CLUSTER=devnet
    ;;
esac

if [ "$CLUSTER" = devnet ]; then
  # Accident guards, not a security boundary: devnet keys are used only in the owner's own shell.
  [ -z "${CLAUDECODE:-}" ] || refuse "this shell is run by an AI agent; devnet keys are used only in the owner's terminal"
  [ -z "${GITHUB_ACTIONS:-}" ] && [ -z "${CI:-}" ] || refuse "devnet keys are never used in CI"
  [ "$MANIFEST" = deployments/devnet/manifest.json ] || refuse "devnet uses only the committed deployments/devnet/manifest.json"
  git ls-files --error-unmatch "$MANIFEST" >/dev/null 2>&1 || refuse "$MANIFEST is not committed; run git pull"
  git diff --quiet HEAD -- "$MANIFEST" || refuse "$MANIFEST has local changes"
fi
[ -f "$MANIFEST" ] || refuse "no frozen manifest at $MANIFEST; run git pull"

manifest() { node scripts/devnet/manifest.mjs get "$MANIFEST" "$1"; }

# A key file must exist and hold the key the manifest expects.
key_matches() {
  local file="$KEY_DIR/$1.json"
  [ -f "$file" ] || refuse "missing $file"
  [ "$(solana-keygen pubkey "$file")" = "$(manifest "$2")" ] || refuse "$file is not the manifest's $2"
}

# The verified program copy written by deploy.sh must still be the frozen build.
program_files_match() {
  local name
  for name in royaltyrail.so royaltyrail.json; do
    [ -f "$PROGRAM_DIR/$name" ] || refuse "missing $PROGRAM_DIR/$name; run scripts/devnet/deploy.sh first"
    [ "$(sha256sum "$PROGRAM_DIR/$name" | cut -c1-64)" = "$(manifest "artifacts/$name/sha256")" ] \
      || refuse "$PROGRAM_DIR/$name does not match the frozen manifest"
  done
}

# Explicit owner authorization, typed at the terminal; never read from a pipe or the environment.
authorize() {
  local phrase="$1" answer
  [ -t 0 ] && [ -t 1 ] || refuse "an interactive terminal is required to authorize this step"
  echo
  read -rp "Type '$phrase' to authorize, or anything else to stop: " answer </dev/tty
  [ "$answer" = "$phrase" ] || refuse "not authorized"
}

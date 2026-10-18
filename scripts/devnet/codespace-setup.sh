#!/usr/bin/env bash
# Prepares a GitHub Codespace (or any Linux x86_64 shell) for the devnet runbook:
# the pinned Solana CLI from a SHA-256-verified release archive, Node dependencies
# from integrity-checked lockfiles without install scripts, and the TypeScript
# reference build used by the lifecycle cross-checks.
set -euo pipefail

SOLANA_VERSION=4.1.2
SOLANA_COMMIT=182084b8
SOLANA_ARCHIVE=solana-release-x86_64-unknown-linux-gnu.tar.bz2
# Identical from https://github.com/anza-xyz/agave/releases and https://release.anza.xyz,
# and identical to the binaries used in every local rehearsal of this runbook.
SOLANA_ARCHIVE_SHA256=5991d027a686eb419a709a479178b33eb83501e8a2bfbf599a81a286bfcbf770
SOLANA_HOME="$HOME/.local/share/royaltyrails/solana-v$SOLANA_VERSION"
SOLANA_BIN="$SOLANA_HOME/bin"
cd "$(git rev-parse --show-toplevel)"
[ "$(uname -sm)" = "Linux x86_64" ] || { echo "Linux x86_64 is required" >&2; exit 1; }

if ! "$SOLANA_BIN/solana" --version 2>/dev/null | grep -qF "solana-cli $SOLANA_VERSION (src:$SOLANA_COMMIT"; then
  work="$(mktemp -d)"
  trap 'rm -rf "$work"' EXIT
  curl -sSfL --retry 3 -o "$work/$SOLANA_ARCHIVE" \
    "https://github.com/anza-xyz/agave/releases/download/v$SOLANA_VERSION/$SOLANA_ARCHIVE"
  echo "$SOLANA_ARCHIVE_SHA256  $work/$SOLANA_ARCHIVE" | sha256sum -c --quiet \
    || { echo "Solana release archive failed SHA-256 verification; not installed" >&2; exit 1; }
  # Only the two CLIs the runbook uses are extracted.
  tar -xjf "$work/$SOLANA_ARCHIVE" -C "$work" \
    solana-release/bin/solana solana-release/bin/solana-keygen solana-release/version.yml
  rm -rf "$SOLANA_HOME"
  mkdir -p "$SOLANA_HOME"
  mv "$work/solana-release/bin" "$work/solana-release/version.yml" "$SOLANA_HOME/"
fi
export PATH="$SOLANA_BIN:$PATH"
if ! grep -qF "$SOLANA_BIN" "$HOME/.bashrc" 2>/dev/null; then
  echo "export PATH=\"$SOLANA_BIN:\$PATH\"" >> "$HOME/.bashrc"
fi
solana --version | grep -F "solana-cli $SOLANA_VERSION (src:$SOLANA_COMMIT"
solana-keygen --version | grep -F "solana-keygen $SOLANA_VERSION (src:$SOLANA_COMMIT"

node_major=$(node -p 'process.versions.node.split(".")[0]')
if [ "$node_major" -lt 20 ]; then
  echo "Node 20 or newer is required (found $(node --version)); run: nvm install 22" >&2
  exit 1
fi

# Lockfiles pin every package by version and integrity hash. Install scripts are
# disabled: the devnet keys live on this machine and no dependency needs them.
npm ci --ignore-scripts --no-audit --no-fund
npm ci --prefix tests/e2e --ignore-scripts --no-audit --no-fund
npm run build

solana config set --url devnet --commitment confirmed >/dev/null
echo "Setup complete: $(solana --version), node $(node --version). Open a new terminal or run: source ~/.bashrc"

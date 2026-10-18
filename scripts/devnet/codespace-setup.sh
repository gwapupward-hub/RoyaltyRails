#!/usr/bin/env bash
# Prepares a GitHub Codespace (or any Linux x86_64 shell) for the devnet runbook:
# pinned Solana CLI, Node dependencies without install scripts, and the
# TypeScript reference build used by the lifecycle cross-checks.
set -euo pipefail

SOLANA_VERSION=4.1.2
cd "$(git rev-parse --show-toplevel)"

SOLANA_BIN="$HOME/.local/share/solana/install/active_release/bin"
export PATH="$SOLANA_BIN:$PATH"
if ! solana --version 2>/dev/null | grep -qF "solana-cli $SOLANA_VERSION"; then
  sh -c "$(curl -sSfL "https://release.anza.xyz/v$SOLANA_VERSION/install")"
fi
if ! grep -qF "$SOLANA_BIN" "$HOME/.bashrc" 2>/dev/null; then
  echo "export PATH=\"$SOLANA_BIN:\$PATH\"" >> "$HOME/.bashrc"
fi
solana --version | grep -F "solana-cli $SOLANA_VERSION"

node_major=$(node -p 'process.versions.node.split(".")[0]')
if [ "$node_major" -lt 20 ]; then
  echo "Node 20 or newer is required (found $(node --version)); run: nvm install 22" >&2
  exit 1
fi

# Install scripts are disabled: the devnet keys live in this machine, and no
# dependency needs to run code at install time for the runbook.
npm ci --ignore-scripts --no-audit --no-fund
npm install --no-save --package-lock=false --ignore-scripts --no-audit --no-fund \
  @anchor-lang/core@1.2.1 @solana/web3.js@1.99.0 @solana/spl-token@0.4.15
npm run build

solana config set --url devnet --commitment confirmed >/dev/null
echo "Setup complete: $(solana --version), node $(node --version). Open a new terminal or run: source ~/.bashrc"

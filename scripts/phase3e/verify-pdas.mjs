#!/usr/bin/env node
// Canonical Program Metadata PDA derivation, using the repository's pinned
// Solana JS client. Installs exclusively from tests/e2e/package-lock.json.
// No RPC, private keys, or transaction signing.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const requireE2e = createRequire(new URL('../../tests/e2e/package.json', import.meta.url));
const { PublicKey } = requireE2e('@solana/web3.js');

const program = new PublicKey('Eo6eWYymSrZ8eJMaSwcbonrcXbbMCNQ5d2e2MVRJjiQB');
const pmp = new PublicKey('ProgM6JCCvbYkfKqJYHePx4xxSUSqJp7rh8Lyv7nk7S');
const expected = {
  idl: ['6Au73HiMX852zhgyTuYNkYDQHZWiCb6rxZ4EsVyyc2p3', 254],
  security: ['6yKDZVfqNwoDDBkSUBG2t2U6aApcNmqC8MtYGuPYDSxb', 255],
};
for (const [name, [address, bumpExpected]] of Object.entries(expected)) {
  // PMP's IDL defines its seed as a fixed 16-byte zero-padded UTF-8 string.
  const seed = Buffer.alloc(16);
  seed.write(name, 'utf8');
  const [pda, bump] = PublicKey.findProgramAddressSync(
    [program.toBuffer(), seed],
    pmp,
  );
  assert.equal(pda.toBase58(), address, name + ': unexpected canonical PDA');
  assert.equal(bump, bumpExpected, name + ': unexpected canonical PDA bump');
  console.log('PASS canonical PMP ' + name + ' PDA ' + address + ' bump ' + bump);
}

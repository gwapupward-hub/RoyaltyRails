#!/usr/bin/env node
// Phase 3E devnet read-only preflight. No signer, wallet, or transaction calls.
// Requires the pinned tests/e2e Solana client installation.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const requireE2e = createRequire(new URL('../../tests/e2e/package.json', import.meta.url));
const { Connection, PublicKey, BPF_LOADER_UPGRADEABLE_PROGRAM_ID } = requireE2e('@solana/web3.js');

const manifest = JSON.parse(readFileSync('deployments/devnet/manifest.json', 'utf8'));
const evidence = JSON.parse(readFileSync('docs/evidence/devnet-deployment.json', 'utf8'));
const program = new PublicKey(manifest.programId);
const metadataProgram = new PublicKey('ProgM6JCCvbYkfKqJYHePx4xxSUSqJp7rh8Lyv7nk7S');
const rpcUrl = process.env.RR_RPC_URL || 'https://api.devnet.solana.com';
const connection = new Connection(rpcUrl, { commitment: 'finalized', disableRetryOnRateLimit: false });
const expectedAuthority = manifest.authorities.upgradeAuthority;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const genesis = await connection.getGenesisHash();
assert.equal(genesis, manifest.genesisHash, 'wrong Solana network or genesis hash');
const [programData] = PublicKey.findProgramAddressSync(
  [program.toBuffer()], BPF_LOADER_UPGRADEABLE_PROGRAM_ID,
);
assert.equal(programData.toBase58(), evidence.programData, 'unexpected program-data address');

function pmpAddress(seedName) {
  const seed = Buffer.alloc(16);
  seed.write(seedName, 'utf8');
  return PublicKey.findProgramAddressSync([program.toBuffer(), seed], metadataProgram)[0];
}
const pmpIdl = pmpAddress('idl');
const pmpSecurity = pmpAddress('security');
assert.equal(pmpIdl.toBase58(), '6Au73HiMX852zhgyTuYNkYDQHZWiCb6rxZ4EsVyyc2p3');
assert.equal(pmpSecurity.toBase58(), '6yKDZVfqNwoDDBkSUBG2t2U6aApcNmqC8MtYGuPYDSxb');

const slot = await connection.getSlot('finalized');
const [pInfo, dInfo, idlInfo, securityInfo] = await connection.getMultipleAccountsInfo(
  [program, programData, pmpIdl, pmpSecurity], 'finalized',
);
assert.ok(pInfo?.executable, 'program does not exist or is not executable');
assert.ok(pInfo.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID), 'wrong program owner');
assert.equal(pInfo.data.readUInt32LE(0), 2, 'wrong program account type');
assert.equal(new PublicKey(pInfo.data.subarray(4, 36)).toBase58(), programData.toBase58());
assert.ok(dInfo?.owner.equals(BPF_LOADER_UPGRADEABLE_PROGRAM_ID), 'wrong program data owner');
assert.equal(dInfo.data.readUInt32LE(0), 3, 'wrong ProgramData account type');
assert.equal(dInfo.data[12], 1, 'upgrade authority unavailable');
assert.equal(new PublicKey(dInfo.data.subarray(13, 45)).toBase58(), expectedAuthority);
const binary = manifest.artifacts['royaltyrail.so'];
assert.equal(sha256(dInfo.data.subarray(45, 45 + binary.bytes)), binary.sha256,
  'on-chain program binary changed from frozen build');
assert.ok(dInfo.data.subarray(45 + binary.bytes).every((b) => b === 0),
  'unexpected nonzero bytes after frozen program');
const record = {
  schema: 'royaltyrails-phase3e-readonly-preflight-v1',
  checkedAt: new Date().toISOString(),
  rpcUrl, genesis, slot, commitment: 'finalized',
  programId: program.toBase58(),
  programData: programData.toBase58(),
  upgradeAuthority: expectedAuthority,
  programBinarySha256: binary.sha256,
  metadataProgramId: metadataProgram.toBase58(),
  accounts: {
    idl: {
      pda: pmpIdl.toBase58(),
      exists: idlInfo !== null,
      owner: idlInfo?.owner.toBase58() ?? null,
      sizeBytes: idlInfo?.data.length ?? 0,
    },
    security: {
      pda: pmpSecurity.toBase58(),
      exists: securityInfo !== null,
      owner: securityInfo?.owner.toBase58() ?? null,
      sizeBytes: securityInfo?.data.length ?? 0,
    },
  },
  ownerReviewNeeded: idlInfo !== null || securityInfo !== null,
  publicationAuthorized: false,
  transactionsSubmitted: 0,
};
if (idlInfo && !idlInfo.owner.equals(metadataProgram)) throw Error('IDL PDA unexpectedly occupied');
if (securityInfo && !securityInfo.owner.equals(metadataProgram)) throw Error('security PDA unexpectedly occupied');
console.log(JSON.stringify(record, null, 2));

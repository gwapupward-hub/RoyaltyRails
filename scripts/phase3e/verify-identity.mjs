#!/usr/bin/env node
// Keyless RoyaltyRails Phase 3E identity and frozen artifact checks.
// No wallet, network connection, or signer is needed.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';

const read = (path) => readFileSync(path);
const json = (path) => JSON.parse(read(path).toString('utf8'));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const identity = json('deployments/devnet/protocol-identity.json');
const manifest = json('deployments/devnet/manifest.json');
const metadata = json('deployments/devnet/security-metadata.json');
const securityProvenance = json('docs/evidence/phase-3e/security-payload.json');
const securityBytes = read('deployments/devnet/security-metadata.json');
assert.equal(securityBytes.length, securityProvenance.utf8Bytes);
assert.equal(sha256(securityBytes), securityProvenance.sha256);
assert.equal(securityProvenance.status, 'DRAFT_NOT_PUBLISHED');
const policy = read('SECURITY.md').toString('utf8');
const programId = 'Eo6eWYymSrZ8eJMaSwcbonrcXbbMCNQ5d2e2MVRJjiQB';
const authority = 'CEhT8a7FrvN7uGCZRruMKp6uzAMusaFQ4XPDRo5i6wSg';
const mail = 'thagwapspot@gmail.com';

assert.equal(identity.schema, 'royaltyrails-protocol-identity-v1');
assert.equal(identity.name, 'RoyaltyRails Protocol');
assert.equal(identity.brand, 'RoyaltyRails');
assert.equal(identity.technicalProgramName, 'royaltyrail');
assert.equal(identity.network, 'solana-devnet');
assert.equal(identity.programId, programId);
assert.equal(identity.programId, manifest.programId);
assert.equal(identity.upgradeAuthority, authority);
assert.equal(identity.upgradeAuthority, manifest.authorities.upgradeAuthority);
assert.equal(manifest.cluster, 'devnet');
assert.equal(manifest.genesisHash, 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG');
assert.equal(identity.frozenBuildSourceCommit, manifest.sourceCommit);
assert.equal(identity.frozenProgramSha256, manifest.artifacts['royaltyrail.so'].sha256);
assert.equal(identity.frozenIdlSha256, manifest.artifacts['royaltyrail.json'].sha256);
assert.equal(identity.securityContact, mail);
assert.equal(identity.securityPolicyUrl, 'https://github.com/gwapupward-hub/RoyaltyRails/blob/07c7f90c648ae27a170b7961d54d1dbd58a9df6f/SECURITY.md');
assert.match(identity.securityContactStatus, /owner_designated/);
assert.deepEqual(identity.publication, {
  pmpIdl: 'not_published',
  pmpSecurity: 'not_published',
  externalVerifiedBuild: 'not_verified',
});
assert.match(identity.economics.onchainCurrent, /^0% /);
assert.match(identity.economics.futurePhase3F, /0\.25%.*1\.00%.*not implemented/);
assert.equal(identity.projectUrl, 'https://github.com/gwapupward-hub/RoyaltyRails');
assert.equal(identity.sourceCode, identity.projectUrl);

const permitted = new Set([
  'name', 'description', 'project_url', 'contacts', 'policy', 'preferred_languages',
  'source_code', 'source_revision',
]);
assert.deepEqual(Object.keys(metadata).sort(), [...permitted].sort());
assert.equal(metadata.name, identity.name);
assert.equal(metadata.description.includes('not audited'), true);
assert.equal(metadata.project_url, identity.projectUrl);
assert.equal(metadata.source_code, identity.sourceCode);
assert.equal(metadata.source_revision, manifest.sourceCommit);
assert.deepEqual(metadata.contacts, ['email:' + mail]);
assert.deepEqual(metadata.preferred_languages, ['en']);
assert.equal(metadata.policy, identity.securityPolicyUrl);
assert.ok(policy.includes(mail));
assert.match(policy, /devnet/i);
assert.match(policy, /not completed an independent smart-contract security audit/i);
assert.equal(existsSync('docs/PHASE_3E.md'), true);

const checkFile = (path, expectedHash, expectedBytes) => {
  const bytes = read(path);
  assert.equal(bytes.length, expectedBytes, path + ': byte-length mismatch');
  assert.equal(sha256(bytes), expectedHash, path + ': frozen hash mismatch');
};

const idlArg = process.argv.indexOf('--idl');
if (idlArg !== -1) {
  assert.ok(process.argv[idlArg + 1], '--idl needs path');
  const path = process.argv[idlArg + 1];
  checkFile(path, identity.frozenIdlSha256, manifest.artifacts['royaltyrail.json'].bytes);
  const idl = json(path);
  assert.equal(idl.address, programId);
  assert.equal(idl.metadata.name, 'royaltyrail');
  assert.ok(idl.instructions.some((x) => x.name === 'fund_and_allocate'));
  assert.ok(idl.instructions.some((x) => x.name === 'allocate_inbox'));
  assert.ok(idl.instructions.some((x) => x.name === 'claim_participant'));
  console.log('PASS: exact frozen Anchor IDL hash, address, and settlement surface');
}
const programArg = process.argv.indexOf('--so');
if (programArg !== -1) {
  assert.ok(process.argv[programArg + 1], '--so needs path');
  checkFile(process.argv[programArg + 1], identity.frozenProgramSha256, manifest.artifacts['royaltyrail.so'].bytes);
  console.log('PASS: exact frozen SBF hash and byte length');
}
console.log('PASS: Phase 3E public identity and security metadata match frozen Phase 3D manifest');

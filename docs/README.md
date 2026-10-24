# Documentation index

RoyaltyRails is devnet-only and unaudited. Nothing here is mainnet approval.

Status key:
- **Current**: the living specification or policy that code and reviews are checked against.
- **Frozen**: a record of something that already happened. Do not edit it; supersede it with a new document.
- **Draft**: proposed, in progress, or not implemented.

The "Doc's own status" column quotes each document's header where it has one.

## Protocol specification

| Document | Purpose | Status | Doc's own status |
| --- | --- | --- | --- |
| [ACCOUNTING_V1.md](ACCOUNTING_V1.md) | Pure canonical allocation math (100,000,000 share units, rounding, residuals). | Current | canonical reference implementation |
| [PROTOCOL_V1.md](PROTOCOL_V1.md) | Solana accounts, instructions, allocation and claim specification. | Current | Phase 2 hardened freeze candidate |
| [STATE_MACHINE_V1.md](STATE_MACHINE_V1.md) | Agreement, supersession, allocation, and claim lifecycle. | Current | Phase 2 hardened freeze candidate |
| [ACCOUNT_LAYOUT_V1.md](ACCOUNT_LAYOUT_V1.md) | Serialization and account size bounds. | Current | Phase 2 hardened freeze candidate |
| [SECURITY_V1.md](SECURITY_V1.md) | Trust boundaries, threat model, and the pre-mainnet gate (§33). | Current | Phase 2 hardened freeze candidate |
| [AGREEMENT_MANIFEST_V1.md](AGREEMENT_MANIFEST_V1.md) | Deterministic human-readable Agreement Manifest and `terms_hash`. | Current | pre-beta interoperability specification |
| [INTEGRATION_UX_V1.md](INTEGRATION_UX_V1.md) | SDK, keepers, fee sponsorship, and operational UX contract. | Current | pre-beta product/integration specification |
| [PREMERGE_AUDIT_V1.md](PREMERGE_AUDIT_V1.md) | Internal pre-merge architecture review findings that hardened v1. Not an independent audit. | Frozen | hardened findings implemented |

## Engineering phases and deployment records

| Document | Purpose | Status | Doc's own status |
| --- | --- | --- | --- |
| [PHASE_3A.md](PHASE_3A.md) | Anchor foundation and TypeScript/Rust parity. | Frozen | implementation complete |
| [PHASE_3D.md](PHASE_3D.md) | Local validator and devnet E2E plan, stages 3D.1 to 3D.4, and hard gates. | Frozen | complete for devnet |
| [PHASE_3D3_ADVERSARIAL_EVIDENCE.md](PHASE_3D3_ADVERSARIAL_EVIDENCE.md) | Adversarial local-validator test evidence. | Frozen | complete for local-validator scope |
| [PHASE_3D4_OWNER_CUSTODY_READINESS.md](PHASE_3D4_OWNER_CUSTODY_READINESS.md) | Owner-custodied devnet key and signing readiness. | Frozen | — |
| [DEPLOYMENT_DEVNET_V1.md](DEPLOYMENT_DEVNET_V1.md) | Public devnet deployment record, compute benchmarks, and unresolved risks. | Frozen | devnet deployed and independently verified |
| [PHASE_3E.md](PHASE_3E.md) | Protocol identity and metadata phase plan. | Draft | in progress |
| [PHASE_3E_PUBLICATION_PLAN.md](PHASE_3E_PUBLICATION_PLAN.md) | Keyless preflight and controlled metadata publication procedure. | Draft | preparation only |
| [PHASE_3E_OWNER_AUTHORIZATION.md](PHASE_3E_OWNER_AUTHORIZATION.md) | Scope of the owner's devnet metadata-publication approval. Not proof of a transaction. | Frozen | owner approval recorded |

## Evidence (frozen records)

| Path | Purpose | Status |
| --- | --- | --- |
| [evidence/](evidence/) | Devnet config, deployment, lifecycle runs, and independent verification JSON. | Frozen |
| [evidence/phase-3e/](evidence/phase-3e/) | Phase 3E preflight, IDL provenance, and security-payload provenance. | Frozen |
| [../deployments/devnet/](../deployments/devnet/) | Frozen devnet manifest, authorities, protocol identity, and draft security metadata. | Frozen |

## Product (outside the protocol audit scope)

| Document | Purpose | Status |
| --- | --- | --- |
| [SOUNDRECEIPT_V1_PRD.md](SOUNDRECEIPT_V1_PRD.md) | SoundReceipt v1 product requirements. | Draft (not implemented) |
| [../apps/soundreceipt/README.md](../apps/soundreceipt/README.md) | SoundReceipt non-production backend foundation (schema, OpenAPI). | Draft |

## Brand

| Document | Purpose | Status |
| --- | --- | --- |
| [brand/README.md](brand/README.md) | Brand kit overview and assets. | Current |
| [brand/BRAND_GUIDELINES.md](brand/BRAND_GUIDELINES.md) | Logo usage, color, and typography rules. | Current |

## Repository policy

| Document | Purpose | Status |
| --- | --- | --- |
| [../SECURITY.md](../SECURITY.md) | Vulnerability disclosure policy. Its permalink at commit `07c7f90` is referenced by the planned on-chain security metadata. | Current |
| [../README.md](../README.md) | Project overview, status, and repository scope. | Current |

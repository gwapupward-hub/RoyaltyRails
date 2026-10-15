# RoyaltyRail Agreement Manifest v1

Status: pre-beta interoperability specification  
Date: 2026-10-15

## 1. Purpose

RoyaltyRail's on-chain agreement hash proves exact economic configuration, but humans and external systems also need one deterministic representation of what the agreement means.

The Agreement Manifest is the portable, human-readable source document used by Studio, SDKs, integrators, evidence exports, and later music-industry mappings.

It is not a substitute for legal counsel or a jurisdiction-specific contract.

## 2. Canonicalization

Manifest JSON MUST conform to I-JSON-compatible constraints and MUST be canonicalized using RFC 8785 JSON Canonicalization Scheme (JCS) before hashing.

```text
terms_hash = SHA256(JCS(manifest))
```

Requirements:

- UTF-8 JSON input;
- no duplicate object keys;
- deterministic JCS property ordering;
- no application-specific whitespace dependence;
- money/base-unit values that could exceed safe JSON-number precision use decimal strings;
- BPS values use ordinary integers;
- no NaN/Infinity/-0 semantics;
- array order is meaningful and MUST NOT be reordered by canonicalization.

The protocol does not parse the JSON. It stores/validates the 32-byte `terms_hash`. SDKs and Studio validate the manifest off-chain before asking a participant to approve the corresponding agreement hash.

## 3. Separation from on-chain economic hash

The canonical on-chain agreement hash independently binds:

- deployment/program domain;
- RevenuePool;
- version + predecessor version;
- settlement mint/token program;
- pool kind/basis/metadata hash;
- `terms_hash`;
- participant authority/share vector.

The manifest supplies the human-readable context—including rich creative roles/credits—anchored by `terms_hash`.

Changing manifest content changes `terms_hash`, therefore changes the agreement hash, and requires new approvals.

## 4. V1 manifest shape

Illustrative **valid 10,000-BPS** example:

```json
{
  "schema": "royaltyrail/agreement-manifest/v1",
  "agreement": {
    "version": 1,
    "predecessorVersion": 0,
    "title": "Money Neva Sleeps — Master Revenue Split",
    "effectiveFrom": "2026-10-15",
    "effectiveUntil": null
  },
  "work": {
    "title": "Money Neva Sleeps",
    "workType": "sound_recording",
    "identifiers": {
      "isrc": null,
      "iswc": null,
      "upc": null,
      "proprietary": []
    }
  },
  "revenuePool": {
    "kind": "MASTER_RECEIPTS",
    "basis": "REVENUE_PARTICIPATION",
    "amountDefinition": "distributable amount actually deposited to RoyaltyRail",
    "grossOrNet": "net",
    "sourceDescription": "Distributor master receipts",
    "currency": "USDC",
    "negativeAdjustmentPolicy": "NET_BEFORE_DEPOSIT"
  },
  "participants": [
    {
      "participantAuthority": "<artist-solana-pubkey>",
      "displayName": "Artist",
      "roles": ["PRIMARY_ARTIST", "SONGWRITER"],
      "shareBps": 9500
    },
    {
      "participantAuthority": "<producer-solana-pubkey>",
      "displayName": "Producer A",
      "roles": ["PRODUCER", "SONGWRITER"],
      "shareBps": 500
    }
  ],
  "terms": {
    "protocolFeeBps": 0,
    "amendmentPolicy": "UNANIMOUS_V1",
    "payoutRoutingIsParticipantControlled": true,
    "publicChainDisclosureAccepted": true
  },
  "documents": [
    {
      "mediaType": "application/pdf",
      "sha256": "<hex-sha256>",
      "label": "Executed split sheet"
    }
  ],
  "notes": null
}
```

The formal JSON Schema should be added before Studio beta. This document freezes semantic requirements first.

## 5. Participant representation

Manifest participant order MUST match canonical on-chain participant-authority byte order when the manifest is presented as the exact approval artifact.

Every participant entry must correspond one-to-one with an on-chain economic participant through:

```text
participantAuthority
shareBps
```

Studio MUST compare those economic fields against the proposed on-chain agreement before signature and MUST reject a manifest whose shares do not total exactly 10,000 BPS.

Creative roles/credits are **manifest metadata**, not duplicate on-chain economic fields. The manifest may assign multiple roles to one participant. Because roles are inside the canonical manifest, they remain cryptographically protected by `terms_hash` without forcing the core Solana account layout to maintain a music-industry role taxonomy.

`displayName` is human-readable metadata and is not a substitute for participant authority.

Do not place tax IDs, government IDs, home addresses, bank details, private emails, or other sensitive PII in the public manifest.

## 6. Role vocabulary

V1 should publish a versioned recommended role vocabulary for Studio/API interoperability while allowing namespaced external vocabulary values where needed.

Example:

```text
PRIMARY_ARTIST
FEATURED_ARTIST
PRODUCER
CO_PRODUCER
EXECUTIVE_PRODUCER
SONGWRITER
COMPOSER
LYRICIST
ENGINEER
MIX_ENGINEER
MASTERING_ENGINEER
LABEL
PUBLISHER
MANAGER
OTHER:<namespace>:<value>
```

Role labels do **not** determine payment math. The approved `shareBps` does.

Future DDEX adapters should map these manifest roles to applicable DDEX party/role vocabulary without requiring a protocol migration.

## 7. Music identifiers

V1 manifest may carry common identifiers where available:

- ISRC for sound recordings;
- ISWC for musical works;
- UPC/EAN for releases;
- IPI/CAE for interested parties only when the product/privacy design determines it is appropriate;
- ISNI or other industry identifiers;
- distributor/label proprietary identifiers.

Identifiers are optional because a split may be agreed before formal release identifiers exist.

Identifier changes after agreement activation do not silently mutate the approved manifest. A later metadata association may be recorded separately if it does not alter economics; changing the approved manifest requires a new agreement version.

## 8. Revenue-pool definition

The manifest must explain exactly what the percentage applies to.

At minimum:

```text
pool kind
settlement basis
gross-or-net convention
source description
settlement asset
negative-adjustment policy
```

RoyaltyRail v1 does not independently validate pre-deposit deductions or external royalty statements. The amount actually allocated by the protocol is authoritative for protocol accounting.

## 9. Negative adjustments and chargebacks

Real royalty statements can contain reversals, corrections, returns, recoupments, or negative adjustments.

RoyaltyRail v1 does not claw back previously claimed tokens and does not create negative participant allocations.

V1 policy:

```text
negativeAdjustmentPolicy = NET_BEFORE_DEPOSIT
```

The payer/integration must net corrections before depositing new distributable USDC or handle the commercial correction outside v1.

A future accounting version may support explicitly consented offsets/waterfalls, but it must not retroactively mutate v1 allocations.

## 10. Effective periods

`effectiveFrom` and `effectiveUntil` are business metadata in v1, not autonomous clock-based routing rules enforced by the program.

A payer/API selects the AgreementVersion that should receive a particular payment. Version-specific Royalty Inboxes preserve historical routing.

Future statement-ingestion services may use effective periods to recommend or automate version selection, but the selected on-chain version remains explicit.

## 11. Document attachments

Attachments are referenced by cryptographic digest, not by mutable URL.

Example:

```json
{
  "mediaType": "application/pdf",
  "sha256": "...",
  "label": "Producer agreement"
}
```

Storage URLs/CIDs may be maintained in a separate resolver/index so storage location can change without changing the approved terms hash.

## 12. Availability requirement

A hash proves integrity but not availability.

Before public beta, Studio must support:

- download/export of the exact canonical manifest;
- exportable agreement evidence package;
- at least one content-addressed or otherwise durable storage path;
- redundant RoyaltyRail-hosted retrieval;
- independent hash verification in SDK/CLI.

The protocol must not require RoyaltyRail's hosted database to verify a manifest a user already possesses.

## 13. Evidence package

A RoyaltyRail evidence export should include:

```text
manifest JSON
canonical JCS bytes or reproducible canonicalization instructions
terms_hash
agreement_hash
AgreementVersion address
program ID + deployment ID
participant authorities/shares
human-readable roles/credits from manifest
approval transactions
supersession-consent transactions where applicable
activation transaction
manifest/document hashes
allocation/claim history references
```

This is designed for auditability. Whether it satisfies a particular legal signature/record requirement is jurisdiction-dependent and requires legal review.

## 14. DDEX compatibility direction

RoyaltyRail should map to established music-data standards instead of inventing incompatible music ontology.

Future mapping work should cover concepts represented by DDEX Musical Work Data and Rights standards, including rights claims, party/role data, work-recording links, and Letters of Direction. Full DDEX implementation is outside protocol v1 and requires the applicable DDEX implementation/licensing process.

RoyaltyRail's manifest/indexer schema must preserve enough stable identifiers and role/right semantics to make later DDEX adapters possible without changing on-chain percentage math.

## 15. Amendment-policy roadmap

V1 uses unanimous economic amendment and predecessor-supersession consent.

Real contracts may permit assignments, delegated administration, court orders, estate succession, or other amendment rules. RoyaltyRail must not fake those workflows using an administrator override.

Future protocol versions may support explicit `AmendmentPolicy` modules only when the policy itself was agreed in advance and cryptographically bound to the agreement.

Until then, V1 intentionally chooses conservative unanimous consent.

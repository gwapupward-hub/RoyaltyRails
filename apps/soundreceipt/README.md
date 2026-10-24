# SoundReceipt v1 — Backend foundation (DRAFT)

Status: **design and database/API foundation only; not an executable service or production migration**.

This package is intentionally isolated from RoyaltyRails' Rust/Anchor settlement program and TypeScript allocation/protocol packages. It implements no HTTP handlers, auth provider, object-storage integration, document scanner, rights decision engine, payments, or PDF generator.

## Product boundary

- V1: document music licenses and creator-video uses for social media, sponsorships, and paid ads.
- Records are user-provided claims until separately corroborated. A receipt does not establish full master/composition, territorial, duration, platform, or paid-ad rights.
- Never emit `LEGALLY_CLEARED`. `POTENTIALLY_PERMITTED` is only an administrative evaluation of recorded terms.
- PPV anchoring and read-only RoyaltyRails work references are **post-MVP**.
- No change to share-unit math, approvals, fee schedule, participant claims, program IDs, custody, or Solana deployments.

## Files

- `db/migrations/0001_initial.sql`: PostgreSQL 15+ data structures, workspace-scoped foreign keys, integrity constraints, indexes, and **FORCE ROW LEVEL SECURITY without policies** (access intentionally fails closed).
- `openapi.yaml`: proposed bearer-authenticated, workspace-scoped API surface and schema contracts; placeholder server URL is not live.
- `tests/foundation.sql`: disposable PostgreSQL migration smoke/foreign-key/RLS denial assertions.
- `redocly.yaml` and `.github/workflows/soundreceipt-foundation.yml`: independently lint the OpenAPI 3.1 contract and test the migration. These checks do not imply an executable or production-ready service.

## Required architecture decisions

1. **Application runtime:** select service framework and deploy strategy before creating handlers. RoyaltyRails' root Node package is currently settlement/reference code, not a web service.
2. **Identity trust boundary:** choose auth provider and map independently verified issuer + subject to the unique `principals.(auth_issuer, auth_subject)` pair. The client must never be allowed to self-assert identity or workspace membership.
3. **Database permissions:** create distinct migrator and restricted application roles. Install reviewed RLS policies and test as the **actual application role** before any data access.
4. **Storage:** private encrypted buckets, quarantine uploads, validate MIME/size and SHA-256 server-side, malware scan, signed URLs, and per-object download authorization.
5. **Rights vocabulary:** confirm license scope/terms with a rights professional; record master and composition permissions separately when known.
6. **Deployment:** keep API, storage and DB credentials separate from on-chain signing keys. Nothing in SoundReceipt requires a Solana wallet.
7. **Plans:** confirm seats, evidence storage limits, retention, and basic/free PDF limits before billing integration.

## Database safety

Migration `0001_initial.sql` enables and forces RLS on every SoundReceipt table **without creating an allow policy**. Foundation CI checks this fail-closed state using a restricted role, but does not test future authenticated policies. This is intentional. A non-privileged service must have no read or write access until a later authorization migration exists.

Migrations should run under a dedicated privileged migrator role in a disposable database first; application sessions must use a different least-privileged role. Do not run a long-lived API as a PostgreSQL superuser, object owner capable of disabling RLS, or a `BYPASSRLS` role.

A future policy layer must test active membership, workspace ownership, role-specific actions, revoked membership, and tenant-scoped document access. Request-supplied workspace IDs and user IDs cannot be treated as authorization. If a custom session variable is used for claims, only a server that has verified the request's identity may set it, and database access must never be exposed to untrusted clients.

**Still required before runtime:** live app-role RLS policies and authenticated cross-tenant denial tests; audit immutability and actor stamping; license/grant-change invalidation of dependent assessments; consistent revision snapshots for PDF packets; network/upload abuse controls; deletion/retention processes; backups/restores; idempotency enforcement; secure job orchestration.

## Intended execution flow

1. Authenticate creator and authorize workspace/role.
2. Write a track and its evidence-linked music license.
3. Record explicit grant scopes; unknown fields remain unknown.
4. Link a track and specific license to a video.
5. Enter a platform/use/territory/date request.
6. Run a versioned rules engine and retain its explainable findings/evidence snapshot.
7. Generate a PDF packet asynchronously from an immutable review snapshot with unverified items disclosed.
8. Give authorized users time-limited access to the packet and relevant evidence.

When a license, grant, track use, or usage context changes, mark impacted assessments **STALE** transactionally and demand reassessment before export or republication.

## Implementation PR sequence

- **PR A:** `docs/SOUNDRECEIPT_V1_PRD.md` — product and architectural baseline (separate draft).
- **PR B (this branch):** SQL + API contract + these security gates, review only.
- **PR C:** selected runtime, migration integration, trusted identity mapping, RLS policies and denial tests.
- **PR D:** track/license/evidence workflows with quarantine and scanning.
- **PR E:** videos, usage rules, PDF packets, audit trails and pilot tests.
- **Post-MVP:** optional PPV integrity proofs and read-only RoyaltyRails references.

Do not merge PR B as if it were a functioning MVP. Do not run the migration on production infrastructure until a database operator has reviewed the RLS and rollback approach.

## Acceptance criteria for this foundation review

- [ ] Schema migration parses and applies on disposable PostgreSQL 15+ in CI.
- [ ] No tenant-linked foreign key allows cross-workspace reference.
- [ ] Unknown permissions remain NULL/unknown, never implied approved.
- [ ] A nonprivileged application role with no policy has no read or insert access (CI foundation test); authenticated role policies remain a separate blocker.
- [ ] OpenAPI 3.1 lint parses the contract and resolves local `$ref` links; request/response examples and route completeness remain follow-up work.
- [ ] API IDs are authorized on every route; role matrix is defined for handler work.
- [ ] No existing royalty allocation or on-chain program source is modified.
- [ ] All remaining security gates are documented before application code begins.

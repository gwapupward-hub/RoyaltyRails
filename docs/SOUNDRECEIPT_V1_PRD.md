# SoundReceipt v1 — Product Requirements Document

**Product:** SoundReceipt by RoyaltyRails  
**Status:** Proposed implementation specification (not implemented)  
**Version:** 0.1 — 2026-10-22  
**Primary repository:** `gwapupward-hub/RoyaltyRails` (integration target; deployment and folder placement TBD)  
**Product decision:** v1 is limited to music-licensing records for creator videos and social-media distribution.

## 1. Product definition

SoundReceipt is a creator-facing music-license records and usage-review application. It lets creators, editors, and teams record the music used in a video; preserve receipts, agreements, and provenance; document permitted uses and restrictions; track where a video is published; and export a defensible evidence packet for a brand or client.

**Promise:** Know what music was used, what evidence supports its use, and what still needs review before republishing or promoting the video.

**Critical boundary:** SoundReceipt is *not* a licensing marketplace, rights registry, legal opinion provider, automated infringement detector, or conclusive source of clearance. An uploaded invoice, music-store purchase, platform audio link, or user assertion is not proof of permission for every use.

## 2. Target customers and jobs to be done

**Primary:** creators republishing content across social channels, branded campaigns, and paid ads; freelancers managing multi-client libraries; small creator production teams.

When I reuse a video, I need to know which tracks were used and which documented permissions apply to this new platform, monetization model, geography, and campaign, so I can identify gaps before delivery to a client.

When a brand requests music clearance evidence, I need one downloadable packet with linked documents, a usage summary, and an explicit list of unresolved issues.

## 3. Goals and exclusions

**v1 outcomes**
- A creator can organize music and evidence into a searchable rights library.
- Every published video can be linked to one or more music tracks and specific license grants.
- A usage assessment records intended platform, use type, territory, start/end date, and associated evidence.
- The UI distinguishes recorded, interpreted, and verified information; it never turns missing evidence into a “cleared” claim.
- A campaign/video PDF packet can be produced and shared securely.
- Teams have role-controlled access and an audit trail.

**Out of scope for v1:** acquiring licenses, discovering unauthorized uses from platform scans, automated contractual interpretation as authoritative, audio fingerprinting, publishing/distribution, automatic payments or settlement, on-chain rights ownership assertions, broad IP asset types, DDEX ingestion, AI legal adjudication, and custodial payment flows.

## 4. Core user journeys

1. **Add track:** create music track record (title, artist, optional identifiers, source, external URLs); attach source receipts, permissions, license text, and notes.
2. **Record terms:** manually capture who issued the license, grantee, rights covered (e.g., master and composition, if known), allowed platforms, organic/branded/paid-ad permissions, territory, dates, modification conditions, and exclusions.
3. **Add video:** record title, owner/client, campaign, publication URLs, planned platform(s), and link one or more track uses, including time ranges where helpful.
4. **Assess use:** create a specific usage request (platform + content context + monetization + territory + date range). Rules show missing/contradictory terms and the supporting grants; reviewer can add notes and mark whether verification was performed.
5. **Export packet:** create a versioned PDF with track/video inventory, supporting evidence index, terms and restrictions, review outcome, reviewer, timestamps, open questions, and cryptographic digest of the packet. Attachments may be exported separately or as a ZIP when explicitly selected and authorized.
6. **Reuse:** duplicate a use request for a new platform/campaign and reassess; never inherit a former decision blindly.
7. **Reminder:** surface licenses approaching expiration and impacted videos/campaigns.

## 5. Functional requirements and acceptance tests

| ID | Requirement | Acceptance criterion | Priority |
|---|---|---|---|
| SR-01 | Workspace and authentication | User signs in, creates a personal workspace, and can switch permitted workspaces. | P0 |
| SR-02 | Track catalog | CRUD tracks; title, artist, source, metadata and external license URL are searchable. | P0 |
| SR-03 | Evidence vault | Accept PDF/JPG/PNG documents up to configurable limits; private storage and authorized access; SHA-256 digest saved. | P0 |
| SR-04 | Licenses and grants | Record issuer, grantee, rights category, permitted use types, platforms, territory, start/end dates, restrictions, provenance, and free-form notes. Missing fields stay unknown. | P0 |
| SR-05 | Videos and campaigns | Add video URLs, client/campaign, track usage links, and usage contexts; video may have several tracks. | P0 |
| SR-06 | Usage assessment | Rules evaluate explicit constraints, report supporting evidence and unknowns; no automated unconditional “cleared.” | P0 |
| SR-07 | Search | Search tracks, videos, campaigns, source, client, expiry and review status within authorized workspace. | P0 |
| SR-08 | Clearance packet | Generate versioned PDF with evidence index, review state, restrictions, known gaps and timestamp. | P0 |
| SR-09 | Team access | Workspace Owner/Admin/Editor/Viewer authorization enforced server-side and in storage. | P0 for Team launch |
| SR-10 | Audit trail | Track create/update/delete, evidence upload, review changes and packet exports with actor and time. | P0 |
| SR-11 | Expiry reminders | In-app 30/7-day reminder of licenses approaching end date; email is optional subsequent feature. | P1 |
| SR-12 | Optional PPV attestation | Generate an evidence digest and proof record without publishing private documents. | Post-MVP |
| SR-13 | RoyaltyRails relationship | Link sound recording/work references or agreement IDs read-only; no settlement side effects. | Post-MVP |

## 6. Assessment vocabulary and policy

Separate **evidence verification** from **usage suitability**:

- `evidence_state`: `SELF_REPORTED`, `DOCUMENT_ATTACHED`, `ISSUER_CONFIRMED` (only after a traceable issuer verification workflow).
- `assessment_state`: `NOT_REVIEWED`, `INSUFFICIENT_EVIDENCE`, `CONFLICT_DETECTED`, `POTENTIALLY_PERMITTED`, `REQUIRES_SPECIALIST_REVIEW`.
- `decision_source`: `RULES_ASSISTED` or `HUMAN_REVIEW`; show source, time, rule-set version and user/reviewer.

Never display a green “legally cleared” guarantee. `POTENTIALLY_PERMITTED` indicates that *recorded* terms appear consistent with the requested use, not that documents are authentic, rights are complete, or platform policies are satisfied. Any missing grant, unknown ownership, expired term, paid-ad prohibition, territory exclusion, or mismatch produces an actionable finding.

A music-use request can require distinct authorizations relating to the sound recording and musical composition. The model must represent them separately when known and retain `UNKNOWN` when not known. Platform-provided music availability is not assumed transferable to branded posts or advertisements.

## 7. Data model (logical)

All business records include UUID `id`, `workspace_id`, `created_at`, `updated_at`, and `created_by` where applicable. Enforce workspace ownership in every query and foreign key relationship.

- **Workspace**: name, owner_id, plan, storage_quota, created_at.
- **Membership**: workspace_id, user_id, role, invited_at, accepted_at, revoked_at.
- **MusicTrack**: title, artist, source_type, source_url, ISRC_optional, ISWC_optional, notes.
- **RightsParty**: display_name, type, contact_reference; used for issuer, grantee, and claimant without asserting legal title.
- **LicenseRecord**: track_id, issuer_party_id, grantee_party_id, license_reference, effective_at, expires_at, terms_url, terms_snapshot_id, evidence_state, notes.
- **LicenseGrant**: license_id, rights_category (`MASTER`, `COMPOSITION`, `BOTH_ASSERTED`, `UNKNOWN`), use_types[], platforms[], territories[], valid_from, valid_until, restrictions JSON, confidence/source_note. Multiple grants per license supported.
- **EvidenceAsset**: license_id nullable, storage_key, mime_type, size, sha256, filename, uploader, uploaded_at, source_type, scan_state, sensitivity, deleted_at.
- **Campaign**: client_label, campaign_name, dates, notes.
- **VideoAsset**: campaign_id nullable, title, owner_label, asset_reference, notes.
- **Publication**: video_id, platform, URL, published_at, visibility, content_type.
- **TrackUse**: video_id, track_id, license_id nullable, start_ms nullable, end_ms nullable, notes.
- **UsageRequest**: video_id, campaign_id nullable, platform, organic_or_branded_or_paid, territory[], planned_from/to, purpose_notes.
- **UsageAssessment**: usage_request_id, assessment_state, findings JSON, evaluated_at, rules_version, reviewed_by nullable, human_review_note, revision.
- **ClearancePacket**: usage_request_ids[], generated_by, generated_at, assessment_revision_ids[], file_key, sha256, version, expires_at nullable.
- **AuditEvent**: actor_id, action, record_type, record_id, workspace_id, timestamp, metadata; append-only.
- **ExternalProofLink** *(deferred)*: packet_id/evidence_id, provider (`PPV`), content_digest, proof_reference, verification_status.

Use separate typed tables for grants and relationships rather than relying exclusively on free-form JSON; JSON is appropriate for extensible restrictions. For future broader media types, keep domain-neutral evidence and rights models internally, but expose only music/video features in v1.

## 8. API outline (JSON over HTTPS)

All routes below are examples under `/api/v1`, require authentication and workspace authorization, and emit stable structured errors. Use cursor pagination for listings and idempotency keys for creating exports and upload sessions.

- `POST /workspaces`, `GET /workspaces/:id`, `POST /workspaces/:id/invitations`
- `GET|POST /tracks`, `GET|PATCH|DELETE /tracks/:id`
- `GET|POST /licenses`, `GET|PATCH /licenses/:id`, `POST /licenses/:id/grants`
- `POST /evidence/upload-intents` (presigned scoped upload), `POST /evidence/:id/complete`, `GET /evidence/:id/download-intent`
- `GET|POST /videos`, `GET|PATCH /videos/:id`, `POST /videos/:id/track-uses`
- `GET|POST /campaigns`, `POST /usage-requests`, `POST /usage-requests/:id/assess`
- `GET /search?q=...`, `POST /clearance-packets`, `GET /clearance-packets/:id`, `POST /clearance-packets/:id/download-intent`
- `GET /audit-events?record_id=...`

Use asynchronous jobs for scanning, packet generation and later attestation. Track progress by polling a job resource; never block API requests on large PDF operations.

## 9. Roles and entitlements

- **Owner:** workspace ownership, subscription, members, delete/export all records.
- **Admin:** manage workspace data and invitations, except ownership/billing transfer.
- **Editor:** add/edit track, evidence, video and campaign records; run assessments and exports.
- **Viewer:** read authorized records and download only documents permitted by workspace policy; cannot mutate rights records.

**Pricing hypothesis to validate:** Free $0 with 20 total track/video records and basic exports; Creator $12/month with unlimited logical records (subject to reasonable storage/abuse limits); Team $39/month with shared library, invited editors and audit filters. Specify storage and seat quotas before billing launch. Do not gate access to a creator's previously uploaded documents merely because a subscription lapses; provide retrieval/export policy.

## 10. Security, privacy and reliability

- Use established authentication, short-lived sessions, optional MFA; no wallet required for v1.
- Enforce workspace isolation at query and object-storage access boundaries; use PostgreSQL RLS as defense in depth where appropriate.
- Private buckets, short-lived signed URLs, strict MIME and file-size controls, malware scanning, no untrusted file execution, safe PDF generation.
- Encrypt data in transit and at rest; manage keys outside code and CI logs. Do not write receipts, credentials, signed URLs or private license content to logs.
- Check both workspace role and object entitlement on each document read, upload and download.
- Maintain append-only audit events; evidence replacement creates a new version rather than overwriting old evidence.
- Use expiring invitations, rate limits, abuse controls, backup/restore drills, retention/deletion policy and incident monitoring.
- Separate user-facing assertions from issuer confirmation; capture who asserted a fact and when.
- Packet footer: “Administrative rights documentation; not a legal opinion or independent certification of clearance.”
- Availability target for pilot: 99.5% monthly app availability (target, not guarantee). Define data recovery objectives before production.

## 11. Integration boundary and rollout safety

**Hard rule:** SoundReceipt v1 must not change RoyaltyRails allocation math, share-unit representation, agreement approvals, existing protocol program IDs, payout wallets, on-chain accounts, settlement fees, or mainnet gate. Product subscription fees are separate from protocol settlement economics.

- SoundReceipt runs off-chain; no Solana wallet or transaction is required for recordkeeping.
- Link a SoundReceipt music asset to a RoyaltyRails `Work`/`RevenuePool` through an optional mapping, never by mutating an approved on-chain agreement.
- Future PPV proof stores document/packet digests and private audit references; the source PDF and identity details stay private. Hashing alone demonstrates integrity relative to an earlier commitment, not legal validity of a license.
- Keep the integration in a separate application/service package or bounded module. Propose exact monorepo placement after confirming active branches and ongoing protocol work.
- Assess repository branch/README consistency before merging implementation code: inspected `main` docs currently identify pre-beta hardening, which may lag other reported development work.

## 12. Implementation plan

**Week 1:** confirm user stories and license terminology with a music attorney/rights professional; implement schema, workspace auth and RLS; design API conventions.

**Week 2:** build track catalog, license/grant CRUD, evidence upload with scanning and digest/versioning.

**Week 3:** video, track-use, publication and campaign associations; search and filtering.

**Week 4:** deterministic, explainable assessment rules, missing-evidence reporting, and a reusable rules fixture suite.

**Week 5:** versioned clearance packet builder, secure downloads, audit log.

**Week 6:** team roles, quotas, abuse controls, reminders, end-to-end tests.

**Weeks 7–8:** pilot onboarding, usability fixes, threat review, pricing validation; prepare opt-in integrations only if they do not delay core release.

Resource assumptions: one experienced full-stack engineer plus part-time design/legal review, using managed auth/database/storage and existing PDF libraries. The previously suggested $1,500–$5,000 is a speculative lean build estimate, not a validated total cost and may exclude experienced labor, legal review, security validation and ongoing infrastructure.

## 13. Test matrix and release gates

- Workspace A cannot list or download any Workspace B license, receipt, packet or audit event.
- Viewer cannot edit any rights record, generate unauthorized sharing link, or invite others.
- A changed/expired/deleted license cannot silently retain a previous assessment; dependent uses are marked stale and queued for reassessment.
- A track with unknown composition permission is never represented as fully cleared.
- A platform-only music permission is not automatically extended to paid advertisements.
- An assessment includes rule set version, source references, outstanding gaps and actor/time.
- PDF shows correct video, license, exact usage, restrictions, evidence digest and unverified items; output is consistent and reproducible for fixed snapshot data.
- Uploading malicious, oversized or spoofed file types is rejected/quarantined.
- Every record and evidence version can be exported by authorized owners, with defined retention behavior.
- No write path from SoundReceipt to RoyaltyRails core settlement contracts; existing RoyaltyRails tests remain unaffected.

**Release criteria:** P0 workflows pass end-to-end; tenancy and document-access tests pass; at least five real creator/team pilot interviews completed; known clearance-language legal review completed; support/runbook, backup restoration test and error monitoring ready.

## 14. Product metrics and open decisions

**Metrics:** time to catalog first track, videos associated with a documented license, percentage of usage requests with unresolved gaps, time to produce packet, creator weekly active retention, pilot-to-paid conversion, support burden, and storage cost per workspace.

**Decisions to close before sprint 1:** hosting stack and repository location; subscription seat/storage caps; whether Free includes PDF export and how many; supported territories and platform vocabulary; preferred link-sharing restrictions; legal reviewer for clearance terminology; pilot cohort and success thresholds.

**Recommended first pull request:** documentation-only `docs/SOUNDRECEIPT_V1_PRD.md`, then a separate database/API foundation PR after architecture approval. Do not merge any changes to the existing on-chain protocol for this feature.
# RightsRunway V1 — Product Direction & Architecture

**Status:** Proposed product specification; not implemented  
**Date:** 2026-10-25  
**Placement:** RoyaltyRails product suite, independently deployable module  
**Initial customer:** Individual creators; agency and manager workspaces supported by the data model  
**V1 priority:** Contract intake, reviewed usage-rights records, calendar, and reminders  
**Explicit non-goals:** Legal advice, automated legal conclusions, content-usage surveillance, music-rights management, royalty calculation, settlement authorization, or payout execution

## 1. Product definition

RightsRunway turns brand-deal contracts into creator-reviewable records of the rights a brand has been granted to use creator content. It presents the extracted terms in plain language and tracks important dates and restrictions.

The product answers:
- Which counterparty received permission to use this content?
- Which asset(s), channels, purposes, territories, and usage types are covered?
- When does the permission begin and end?
- Are paid-media, whitelisting, exclusivity, editing, renewal, or sublicensing terms present?
- Which terms are missing, ambiguous, or awaiting human confirmation?
- What deadlines need attention?

RightsRunway records and explains contract language; it does not determine legal enforceability or replace counsel.

## 2. Product boundaries

### RightsRunway
Owns brand-deal contract intake, document versions, extracted clauses, creator-confirmed usage terms, rights calendars, reminders, and audit history.

### SoundReceipt
Remains limited in V1 to music licensing for creator videos and social media. It records music-related license information and assessments. It does not become the general brand-contract tracker.

### RoyaltyRails Protocol and settlement
The existing Rust/Anchor protocol and settlement/accounting packages remain independent. RightsRunway and SoundReceipt must not call settlement instructions, modify agreement economics, set claimable balances, authorize payouts, or treat a rights status as settlement approval.

Any future integration is read-only and explicitly versioned. Rights records and settlement agreements are separate concepts; a reference between them is not authority to execute a financial action.

## 3. Customer and workspace model

- **Creator workspace:** Default V1 experience; one creator can manage contracts and content assets.
- **Agency workspace:** A workspace can have multiple creator profiles and authorized team members. Agency support must be represented in the tenancy and permission model from the start, even if advanced agency dashboards ship later.
- **Membership:** Role and workspace-scoped permissions determine access. A creator's private contract must not become visible to an agency merely because both parties exist in the system.
- **Counterparty:** Brand, agency, or other contracting party, scoped to the relevant workspace.
- **Access rules:** Every row and every document is tenant-scoped. Enforce authorization in the API and database; do not rely on UI filtering.

Initial roles: workspace owner, creator/member, manager, and read-only reviewer. Counsel access, if added, must be explicitly granted and revocable.

## 4. V1 user journey

1. Creator creates or selects a workspace and content asset.
2. Creator uploads a PDF or enters/pastes contract text from an email.
3. System stores the original privately, creates a versioned contract record, and extracts candidate clauses/fields.
4. RightsRunway displays each candidate term alongside the source text/page reference and confidence or review status.
5. Creator edits and confirms terms; uncertain or missing values remain explicitly unknown.
6. System creates a rights summary and calendar entries from confirmed dates and terms.
7. Reminder service sends configurable alerts before expiration, renewal, or exclusivity deadlines.
8. Creator can revisit the source contract, change a term, and see an audit trail of the change.

A manually entered record is a first-class workflow. The MVP must remain usable when document extraction fails.

## 5. V1 scope

### Required
- PDF upload and manual/email-text intake
- Private document storage and contract version history
- Structured extraction with human-editable fields
- Plain-language summaries linked to the source clause
- Rights calendar with start/end/renewal dates
- Configurable reminders and delivery status
- Flags for paid usage, organic usage, whitelisting/creator-handle authorization, exclusivity, editing/derivative rights, territory, platforms/channels, sublicensing, renewal, and term/expiration
- Unknown, ambiguous, conflicting, and missing-term states
- Audit trail for edits, confirmations, reminders, and access-sensitive actions
- Workspace and role-based access control
- Exportable creator-readable rights summary, clearly marked as informational and not legal advice

### Deferred
- Automated monitoring or scraping of brand ads and social posts
- Computer-vision matching of published content
- Automated takedown or cease-and-desist workflows
- Legal advice, enforceability scoring, or definitive conclusions about whether a use is lawful
- Negotiation/redlining and contract generation
- E-signature and payment processing
- Music licensing assessment (owned by SoundReceipt)
- Rights for beats, samples, artwork, and video clips as first-class SoundReceipt V1 asset types
- Any blockchain storage of contracts, personal data, or confidential clauses
- Any direct connection to protocol settlement instructions

## 6. Core domain model

All records use opaque IDs, timestamps, workspace ownership, and audit metadata. Exact SQL types and constraints are to be defined in migrations.

- `workspaces`: creator or agency workspace; type and owner.
- `workspace_memberships`: user, workspace, role, status, granted/revoked timestamps.
- `creator_profiles`: creator identity/profile inside a workspace; agency workspaces may contain multiple profiles.
- `counterparties`: brands and contracting organizations.
- `content_assets`: creator-owned or creator-managed post/video identifiers and URLs; no assumption that a URL proves ownership.
- `contracts`: workspace, counterparty, title, status, effective dates when confirmed, current version.
- `contract_versions`: immutable uploaded file/text version, checksum, storage key, source metadata, uploaded-by, created-at.
- `contract_clauses`: clause text or protected excerpt, source page/section reference, extraction method, review status.
- `usage_grants`: structured candidate/confirmed permissions tied to a contract version and optionally to one or more assets.
- `usage_terms`: usage type, purpose, platforms, territory, term start/end, paid-media status, whitelisting, exclusivity, edit/derivative permission, sublicensing, renewal mechanics, and uncertainty state.
- `rights_events`: normalized dates/deadlines such as term start, expiration, renewal notice deadline, and exclusivity end.
- `reminders`: schedule, recipient, delivery channel, delivery status, retry metadata, and idempotency key.
- `audit_events`: append-only record of material changes, confirmations, exports, and permission changes.

### Data integrity rules
- A contract version is immutable after upload; corrections create a new version or a separately audited annotation.
- Extracted values are candidates until a permitted human reviewer confirms them.
- Every confirmed field retains provenance to a source clause/page or records that it was manually supplied.
- Missing dates stay null/unknown; never infer an expiration date from an unrelated field.
- Preserve time zone/date semantics and distinguish calendar dates from exact timestamps.
- Keep the original source available to authorized users for comparison.
- Deleting a workspace must follow a documented retention and secure deletion policy, including object storage and derived text.

## 7. Rights state and interpretation model

Use explicit states rather than a single green/red “cleared” indicator:

- `not_reviewed`
- `needs_review`
- `confirmed_by_user`
- `confirmed_by_authorized_reviewer`
- `ambiguous`
- `conflicting_terms`
- `missing_information`
- `expired_by_recorded_date`
- `superseded`

An expired-by-recorded-date state means the recorded term end has passed; it is not a legal conclusion about every possible continuing right. Amendments, renewal clauses, holdover terms, and termination provisions can complicate interpretation. When detected or unresolved, surface the issue for review instead of silently deciding it.

The interface must distinguish:
1. **Source text** — what the contract says.
2. **Extracted candidate** — what the system believes the clause may mean.
3. **Creator-confirmed record** — the user-approved structured value.
4. **Informational summary** — a plain-language explanation, not legal advice.

## 8. Reference architecture

Recommended initial implementation, subject to repository-level implementation review:

- **Application:** TypeScript web application under `apps/rightsrunway/`, integrated into the RoyaltyRails product navigation while remaining independently deployable.
- **API:** Versioned REST API and OpenAPI contract for intake, contracts, clauses, usage grants, calendar events, reminders, and audit records.
- **Persistence:** Managed PostgreSQL with a RightsRunway-specific schema/database role, migrations, tenant-aware foreign keys, and row-level security where supported.
- **Document storage:** Private object storage, short-lived signed download URLs, encryption at rest, upload size/type validation, malware scanning, and least-privilege access.
- **Extraction:** Pluggable PDF text extraction/OCR and structured field extraction. Treat contract content as untrusted input; never allow document text to trigger tools, code, or unauthorized actions.
- **Reminders:** Background job/queue with idempotent scheduling, retries, delivery status, user preferences, and duplicate suppression.
- **Observability:** Redacted application logs, access/security audit events, metrics for extraction quality and reminder delivery; do not log full contract contents by default.
- **Authentication:** Use a reviewed identity integration; authorize every request against workspace membership and role. Never trust a client-supplied workspace ID alone.
- **Deployment:** Separate environment variables, database credentials, storage permissions, and deployment configuration from the Solana protocol and SoundReceipt runtime.

This is a modular service boundary, not a requirement to start with microservices. Keep a coherent application codebase and isolate domain, persistence, and permissions; split runtime services only when operationally justified.

## 9. API surface (proposed)

- `POST /v1/contracts` — create a contract shell/manual record.
- `POST /v1/contracts/{contractId}/versions` — upload or submit a new immutable version.
- `GET /v1/contracts/{contractId}` — retrieve authorized contract and current review state.
- `GET /v1/contracts/{contractId}/clauses` — inspect extracted/source-linked clauses.
- `PATCH /v1/usage-grants/{grantId}` — edit a candidate term with audit metadata.
- `POST /v1/usage-grants/{grantId}/confirm` — confirm a reviewed record.
- `GET /v1/rights-events` — query calendar deadlines in a date range.
- `POST /v1/reminder-preferences` — configure reminder settings.
- `GET /v1/audit-events` — retrieve authorized audit history.

API responses must expose provenance, review status, and unknown fields explicitly. Writes require authorization, validation, CSRF protection where applicable, rate limiting, and audit events. Use optimistic concurrency or version checks for edits to avoid silently overwriting reviewer changes.

## 10. Security and privacy requirements

- Private contracts and extracted clauses are confidential by default.
- Tenant isolation must be tested across API queries, storage access, background jobs, exports, and database policies.
- Use separate least-privilege credentials from RoyaltyRails settlement and SoundReceipt.
- No contract text, personally identifying information, or confidential clauses on-chain.
- Do not place secrets, signed URLs, raw contract text, or tokens in logs.
- Enforce upload limits, file-signature validation, malware scanning, and safe PDF processing.
- Require explicit permission for agency members to access each creator's records.
- Record who uploaded, viewed/exported where required, edited, confirmed, or shared a contract.
- Define retention, account closure, export, deletion, and backup expiry policies before production.
- Do not train third-party models on uploaded contract content unless a separate, explicit and informed opt-in is established.

## 11. Integration contract with SoundReceipt and settlement

For V1, there is no synchronous dependency between RightsRunway and SoundReceipt. A future cross-reference may associate a content asset with a SoundReceipt record through opaque identifiers and a narrow, versioned interface.

Any future shared content record must not merge the two permission types:
- Brand usage permission governs how a sponsor may reuse creator content under a brand deal.
- Music license permission governs the relevant musical composition/recording and licensed use.
- Neither record proves the other permission exists.
- Neither record is legal advice or a guarantee that a use is cleared.

RightsRunway has no protocol wallet, signer, settlement RPC client, or authority to submit settlement instructions. If future business workflows need to reference a RoyaltyRails agreement, use a read-only external reference and keep financial approval in the existing settlement domain.

## 12. Acceptance criteria for V1

1. A creator can upload a PDF or manually enter contract terms without extraction.
2. An uploaded file is private and only accessible to authorized workspace members.
3. Every extracted term is marked as unreviewed until a human confirms it.
4. A user can trace a displayed term to its source clause/page or manual entry.
5. Unknown or conflicting terms are visible and are never silently filled with guesses.
6. Confirmed dates appear in a calendar and generate configured reminders.
7. Duplicate reminder jobs do not send duplicate notifications.
8. Contract amendments preserve the prior version and provide an audit trail.
9. Cross-workspace access tests fail closed for API, database, file storage, exports, and background tasks.
10. A creator can revoke an agency member's access without exposing private records afterward.
11. RightsRunway tests demonstrate no dependency on or mutation of settlement state.
12. SoundReceipt V1 scope remains music licensing for videos and social media; RightsRunway does not broaden it.
13. The interface clearly states that summaries are informational, may require review, and are not legal advice.
14. CI validates migrations, API schema, authorization boundaries, and core lifecycle tests before release.

## 13. Delivery sequence

### Phase 0 — Architecture and risk review
Confirm workspace/auth model, document retention policy, data classification, threat model, and API contract. Review jurisdiction-specific legal disclaimers with qualified counsel.

### Phase 1 — Manual-first contract tracker
Build contract records, private uploads, manual term entry, review states, rights calendar, reminders, and audit history.

### Phase 2 — Assisted extraction
Add PDF parsing and candidate clause/field extraction with source references, confidence/review cues, and human confirmation. Measure field-level accuracy on a consented evaluation set before enabling broad use.

### Phase 3 — Agency workflow
Add creator switching, scoped team invitations, delegated review, and agency-level portfolio views. Preserve creator-level authorization and confidentiality.

### Phase 4 — Usage monitoring (later)
Evaluate opt-in asset matching and public/ad-library monitoring only after the contract record system is reliable. Monitoring findings are evidence to review, not automatic legal determinations or takedown actions.

## 14. Success metrics

- Time from upload to a creator-reviewed rights record
- Percentage of required fields explicitly confirmed or marked unknown
- Extraction correction rate by field
- Reminder delivery success and actionable deadline engagement
- Percentage of contracts with source-linked terms
- Cross-tenant authorization test coverage and incident rate
- Creator retention and active contracts per workspace
- Agency conversion and creator-level permission incidents

Do not optimize for the number of automated “cleared” labels. Optimize for traceability, accuracy, timely reminders, and creator understanding.

## 15. Release gate

This document is a product and architecture proposal, not evidence of an implemented or production-ready service. Do not launch with real confidential contracts until authentication, authorization, upload scanning, secure storage, tenant-isolation tests, retention/deletion policy, operational monitoring, and legal-template review are complete.

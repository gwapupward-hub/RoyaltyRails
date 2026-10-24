-- SoundReceipt by RoyaltyRails / schema foundation v1
-- PostgreSQL 15+; isolated off-chain application schema.
-- IMPORTANT: RLS is enabled FORCE with NO policies. Access DENIED to application roles
-- until a separately reviewed authentication/authorization adapter installs policies.
-- Do not run this migration against a production database without a rollback plan.

BEGIN;
CREATE SCHEMA IF NOT EXISTS soundreceipt;

CREATE TABLE soundreceipt.principals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Both values must come from a server-verified authentication token.
  auth_issuer text NOT NULL,
  auth_subject text NOT NULL,
  UNIQUE (auth_issuer, auth_subject),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT principal_issuer_nonempty CHECK (length(trim(auth_issuer)) > 0),
  CONSTRAINT principal_subject_nonempty CHECK (length(trim(auth_subject)) > 0)
);

CREATE TABLE soundreceipt.workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_principal_id uuid NOT NULL REFERENCES soundreceipt.principals(id),
  name text NOT NULL,
  plan text NOT NULL DEFAULT 'FREE'
    CHECK (plan IN ('FREE', 'CREATOR', 'TEAM')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_name_nonempty CHECK (length(trim(name)) > 0)
);

CREATE TABLE soundreceipt.memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES soundreceipt.workspaces(id),
  principal_id uuid NOT NULL REFERENCES soundreceipt.principals(id),
  role text NOT NULL CHECK (role IN ('ADMIN', 'EDITOR', 'VIEWER')),
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, principal_id),
  UNIQUE (workspace_id, id)
);

CREATE TABLE soundreceipt.music_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES soundreceipt.workspaces(id),
  title text NOT NULL,
  artist text NOT NULL,
  source_label text,
  source_url text,
  isrc text,
  iswc text,
  notes text,
  created_by uuid NOT NULL REFERENCES soundreceipt.principals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  CONSTRAINT track_title_nonempty CHECK (length(trim(title)) > 0),
  CONSTRAINT track_artist_nonempty CHECK (length(trim(artist)) > 0)
);

CREATE TABLE soundreceipt.rights_parties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES soundreceipt.workspaces(id),
  display_name text NOT NULL,
  party_kind text NOT NULL DEFAULT 'UNKNOWN'
    CHECK (party_kind IN ('PERSON','ORGANIZATION','UNKNOWN')),
  contact_reference text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id)
);

CREATE TABLE soundreceipt.licenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES soundreceipt.workspaces(id),
  track_id uuid NOT NULL,
  issuer_party_id uuid,
  grantee_party_id uuid,
  reference text,
  terms_url text,
  effective_at date,
  expires_at date,
  evidence_state text NOT NULL DEFAULT 'SELF_REPORTED'
    CHECK (evidence_state IN ('SELF_REPORTED','DOCUMENT_ATTACHED','ISSUER_CONFIRMED')),
  issuer_verification_reference text,
  notes text,
  created_by uuid NOT NULL REFERENCES soundreceipt.principals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, track_id) REFERENCES soundreceipt.music_tracks(workspace_id, id),
  FOREIGN KEY (workspace_id, issuer_party_id) REFERENCES soundreceipt.rights_parties(workspace_id, id),
  FOREIGN KEY (workspace_id, grantee_party_id) REFERENCES soundreceipt.rights_parties(workspace_id, id),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, track_id, id),
  CONSTRAINT license_valid_dates CHECK (expires_at IS NULL OR effective_at IS NULL OR expires_at >= effective_at),
  CONSTRAINT confirmed_issuer_has_reference
    CHECK (evidence_state <> 'ISSUER_CONFIRMED' OR
      (issuer_verification_reference IS NOT NULL AND length(trim(issuer_verification_reference)) > 0))
);

CREATE TABLE soundreceipt.license_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES soundreceipt.workspaces(id),
  license_id uuid NOT NULL,
  rights_category text NOT NULL DEFAULT 'UNKNOWN'
    CHECK (rights_category IN ('MASTER','COMPOSITION','BOTH_ASSERTED','UNKNOWN')),
  -- NULL = unknown; empty array = explicitly no permitted values.
  allowed_use_types text[],
  allowed_platforms text[],
  allowed_territories text[],
  paid_advertising_allowed boolean,
  valid_from date,
  valid_until date,
  restrictions jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_basis text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, license_id) REFERENCES soundreceipt.licenses(workspace_id, id),
  UNIQUE (workspace_id, id),
  CONSTRAINT grant_valid_dates CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from),
  CONSTRAINT grant_restrictions_object CHECK (jsonb_typeof(restrictions) = 'object')
);

CREATE TABLE soundreceipt.evidence_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES soundreceipt.workspaces(id),
  license_id uuid,
  storage_key text NOT NULL,
  original_filename text NOT NULL,
  mime_type text NOT NULL
    CHECK (mime_type IN ('application/pdf','image/jpeg','image/png')),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  sha256_hex text NOT NULL CHECK (sha256_hex ~ '^[a-f0-9]{64}$'),
  object_version integer NOT NULL DEFAULT 1 CHECK (object_version > 0),
  scan_state text NOT NULL DEFAULT 'PENDING'
    CHECK (scan_state IN ('PENDING','CLEAN','QUARANTINED','REJECTED')),
  provenance text,
  uploaded_by uuid NOT NULL REFERENCES soundreceipt.principals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  FOREIGN KEY (workspace_id, license_id) REFERENCES soundreceipt.licenses(workspace_id, id),
  UNIQUE (workspace_id, id),
  UNIQUE (workspace_id, storage_key)
);

CREATE TABLE soundreceipt.campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES soundreceipt.workspaces(id),
  name text NOT NULL,
  client_label text,
  starts_at date,
  ends_at date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  CONSTRAINT campaign_valid_dates CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at >= starts_at)
);

CREATE TABLE soundreceipt.videos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES soundreceipt.workspaces(id),
  campaign_id uuid,
  title text NOT NULL,
  owner_label text,
  asset_reference text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, campaign_id) REFERENCES soundreceipt.campaigns(workspace_id, id),
  UNIQUE (workspace_id, id)
);

CREATE TABLE soundreceipt.publications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES soundreceipt.workspaces(id),
  video_id uuid NOT NULL,
  platform text NOT NULL,
  publication_url text NOT NULL,
  published_at timestamptz,
  content_type text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, video_id) REFERENCES soundreceipt.videos(workspace_id, id),
  UNIQUE (workspace_id, id)
);

CREATE TABLE soundreceipt.track_uses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES soundreceipt.workspaces(id),
  video_id uuid NOT NULL,
  track_id uuid NOT NULL,
  license_id uuid,
  start_ms integer CHECK (start_ms IS NULL OR start_ms >= 0),
  end_ms integer CHECK (end_ms IS NULL OR end_ms >= 0),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, video_id) REFERENCES soundreceipt.videos(workspace_id, id),
  FOREIGN KEY (workspace_id, track_id) REFERENCES soundreceipt.music_tracks(workspace_id, id),
  FOREIGN KEY (workspace_id, track_id, license_id)
    REFERENCES soundreceipt.licenses(workspace_id, track_id, id),
  UNIQUE (workspace_id, id),
  CONSTRAINT track_use_valid_segment CHECK (end_ms IS NULL OR start_ms IS NULL OR end_ms >= start_ms)
);

CREATE TABLE soundreceipt.usage_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES soundreceipt.workspaces(id),
  video_id uuid NOT NULL,
  campaign_id uuid,
  platform text NOT NULL,
  use_type text NOT NULL CHECK (use_type IN ('ORGANIC','BRANDED','PAID_AD','OTHER')),
  territories text[],
  planned_from date,
  planned_until date,
  purpose_notes text,
  created_by uuid NOT NULL REFERENCES soundreceipt.principals(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, video_id) REFERENCES soundreceipt.videos(workspace_id, id),
  FOREIGN KEY (workspace_id, campaign_id) REFERENCES soundreceipt.campaigns(workspace_id, id),
  UNIQUE (workspace_id, id),
  CONSTRAINT usage_valid_dates CHECK (planned_until IS NULL OR planned_from IS NULL OR planned_until >= planned_from)
);

CREATE TABLE soundreceipt.usage_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES soundreceipt.workspaces(id),
  usage_request_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  assessment_state text NOT NULL
    CHECK (assessment_state IN ('NOT_REVIEWED','INSUFFICIENT_EVIDENCE',
      'CONFLICT_DETECTED','POTENTIALLY_PERMITTED','REQUIRES_SPECIALIST_REVIEW')),
  evidence_state text NOT NULL
    CHECK (evidence_state IN ('SELF_REPORTED','DOCUMENT_ATTACHED','ISSUER_CONFIRMED')),
  decision_source text NOT NULL CHECK (decision_source IN ('RULES_ASSISTED','HUMAN_REVIEW')),
  rules_version text NOT NULL,
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  evidence_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  stale boolean NOT NULL DEFAULT false,
  reviewed_by uuid REFERENCES soundreceipt.principals(id),
  human_review_note text,
  evaluated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (workspace_id, usage_request_id) REFERENCES soundreceipt.usage_requests(workspace_id, id),
  UNIQUE (workspace_id, usage_request_id, revision),
  UNIQUE (workspace_id, id),
  CONSTRAINT findings_array CHECK (jsonb_typeof(findings) = 'array')
);

CREATE TABLE soundreceipt.clearance_packets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES soundreceipt.workspaces(id),
  created_by uuid NOT NULL REFERENCES soundreceipt.principals(id),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  status text NOT NULL DEFAULT 'QUEUED'
    CHECK (status IN ('QUEUED','GENERATING','READY','FAILED')),
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  pdf_storage_key text,
  sha256_hex text CHECK (sha256_hex ~ '^[a-f0-9]{64}$'),
  generated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, id),
  CONSTRAINT ready_has_object CHECK (status <> 'READY' OR
    (pdf_storage_key IS NOT NULL AND sha256_hex IS NOT NULL AND generated_at IS NOT NULL))
);

CREATE TABLE soundreceipt.packet_assessments (
  workspace_id uuid NOT NULL REFERENCES soundreceipt.workspaces(id),
  packet_id uuid NOT NULL,
  assessment_id uuid NOT NULL,
  PRIMARY KEY (workspace_id, packet_id, assessment_id),
  FOREIGN KEY (workspace_id, packet_id) REFERENCES soundreceipt.clearance_packets(workspace_id, id),
  FOREIGN KEY (workspace_id, assessment_id) REFERENCES soundreceipt.usage_assessments(workspace_id, id)
);

CREATE TABLE soundreceipt.audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES soundreceipt.workspaces(id),
  actor_id uuid NOT NULL REFERENCES soundreceipt.principals(id),
  action text NOT NULL,
  record_type text NOT NULL,
  record_id uuid,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_details_object CHECK (jsonb_typeof(details) = 'object')
);

CREATE INDEX sr_tracks_search ON soundreceipt.music_tracks(workspace_id, lower(title), lower(artist));
CREATE INDEX sr_licenses_track ON soundreceipt.licenses(workspace_id, track_id);
CREATE INDEX sr_grants_license ON soundreceipt.license_grants(workspace_id, license_id);
CREATE INDEX sr_evidence_license ON soundreceipt.evidence_assets(workspace_id, license_id);
CREATE INDEX sr_videos_campaign ON soundreceipt.videos(workspace_id, campaign_id);
CREATE INDEX sr_publications_video ON soundreceipt.publications(workspace_id, video_id);
CREATE INDEX sr_track_uses_video ON soundreceipt.track_uses(workspace_id, video_id);
CREATE INDEX sr_track_uses_license ON soundreceipt.track_uses(workspace_id, license_id);
CREATE INDEX sr_requests_video ON soundreceipt.usage_requests(workspace_id, video_id);
CREATE INDEX sr_assessments_request ON soundreceipt.usage_assessments(workspace_id, usage_request_id, revision DESC);
CREATE INDEX sr_audit_recent ON soundreceipt.audit_events(workspace_id, occurred_at DESC);

-- Explicit fail-closed RLS. No permissive policies are supplied in foundation v1.
-- API access must remain disabled until trusted authentication, role claims,
-- document authorization, policy tests, and least-privilege database grants exist.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'soundreceipt'
  LOOP
    EXECUTE format('ALTER TABLE soundreceipt.%I ENABLE ROW LEVEL SECURITY', r.tablename);
    EXECUTE format('ALTER TABLE soundreceipt.%I FORCE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
END $$;

COMMIT;

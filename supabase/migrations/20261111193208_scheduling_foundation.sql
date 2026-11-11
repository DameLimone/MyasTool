-- Additive foundation only. No organization, schedule, customer or booking is seeded.
CREATE SCHEMA IF NOT EXISTS scheduling;
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;
REVOKE ALL ON SCHEMA scheduling FROM PUBLIC;

-- The existing Clerk-backed application uses trusted transaction-local identity.
-- Supabase Data API roles receive no table privileges or automatic memberships.
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_users_self_select ON public.app_users FOR SELECT
  USING (id = nullif(current_setting('mya.user_id', true), ''));
CREATE POLICY app_users_self_insert ON public.app_users FOR INSERT
  WITH CHECK (id = nullif(current_setting('mya.user_id', true), ''));
CREATE POLICY memberships_self_select ON public.organization_memberships FOR SELECT
  USING (user_id = nullif(current_setting('mya.user_id', true), '') AND revoked_at IS NULL);
CREATE POLICY organizations_member_select ON public.organizations FOR SELECT
  USING (disabled_at IS NULL AND EXISTS (
    SELECT 1 FROM public.organization_memberships m
    JOIN public.app_users u ON u.id = m.user_id
    WHERE m.organization_id = organizations.id
      AND m.user_id = nullif(current_setting('mya.user_id', true), '')
      AND m.revoked_at IS NULL AND u.disabled_at IS NULL
  ));
CREATE INDEX organization_memberships_user_fk_idx ON public.organization_memberships(user_id);
CREATE INDEX jobs_organization_fk_idx ON public.jobs(organization_id);

CREATE TABLE scheduling.resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);

CREATE TABLE scheduling.settings (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id),
  resource_id uuid NOT NULL,
  booking_mode text NOT NULL DEFAULT 'square_only' CHECK (booking_mode IN ('square_only','shadow','first_party')),
  public_booking_enabled boolean NOT NULL DEFAULT false,
  rules_confirmed_at timestamptz,
  rules_confirmed_by text REFERENCES public.app_users(id),
  hold_minutes integer NOT NULL DEFAULT 10 CHECK (hold_minutes BETWEEN 1 AND 15),
  slot_minutes integer NOT NULL DEFAULT 15 CHECK (slot_minutes BETWEEN 5 AND 60),
  notice_minutes integer NOT NULL DEFAULT 0 CHECK (notice_minutes BETWEEN 0 AND 43200),
  horizon_days integer NOT NULL DEFAULT 90 CHECK (horizon_days BETWEEN 1 AND 365),
  buffer_before_minutes integer NOT NULL DEFAULT 0 CHECK (buffer_before_minutes BETWEEN 0 AND 180),
  buffer_after_minutes integer NOT NULL DEFAULT 0 CHECK (buffer_after_minutes BETWEEN 0 AND 180),
  square_sync_max_age_seconds integer NOT NULL DEFAULT 300 CHECK (square_sync_max_age_seconds BETWEEN 30 AND 3600),
  cutover_from date,
  cutover_to date,
  square_writes_closed_at timestamptz,
  migration_approved_report_id uuid,
  cancellation_policy text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, resource_id) REFERENCES scheduling.resources(organization_id, id),
  CHECK ((cutover_from IS NULL AND cutover_to IS NULL) OR (cutover_from IS NOT NULL AND cutover_to IS NOT NULL AND cutover_from < cutover_to)),
  CHECK (NOT public_booking_enabled OR (booking_mode = 'first_party'
    AND rules_confirmed_at IS NOT NULL AND rules_confirmed_by IS NOT NULL
    AND cutover_from IS NOT NULL AND cutover_to IS NOT NULL
    AND square_writes_closed_at IS NOT NULL AND migration_approved_report_id IS NOT NULL
    AND coalesce(length(btrim(cancellation_policy)), 0) > 0))
);
CREATE INDEX settings_resource_fk_idx ON scheduling.settings(organization_id, resource_id);
CREATE INDEX settings_confirmed_by_fk_idx ON scheduling.settings(rules_confirmed_by);

CREATE TABLE scheduling.services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  kind text NOT NULL CHECK (kind IN ('main','addon')),
  price_minor integer NOT NULL CHECK (price_minor BETWEEN 0 AND 10000000),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 1 AND 480),
  published boolean NOT NULL DEFAULT false,
  display_order integer NOT NULL DEFAULT 0,
  square_variation_id text,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id)
);
CREATE INDEX services_published_idx ON scheduling.services(organization_id, display_order, id) WHERE published;
CREATE INDEX services_organization_fk_idx ON scheduling.services(organization_id);
CREATE TABLE scheduling.service_combinations (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  main_service_id uuid NOT NULL,
  addon_service_id uuid NOT NULL,
  PRIMARY KEY (organization_id, main_service_id, addon_service_id),
  FOREIGN KEY (organization_id, main_service_id) REFERENCES scheduling.services(organization_id, id),
  FOREIGN KEY (organization_id, addon_service_id) REFERENCES scheduling.services(organization_id, id),
  CHECK (main_service_id <> addon_service_id)
);
CREATE INDEX combinations_addon_fk_idx ON scheduling.service_combinations(organization_id, addon_service_id);

CREATE TABLE scheduling.working_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  resource_id uuid NOT NULL,
  weekday integer NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  start_local time NOT NULL,
  end_local time NOT NULL,
  FOREIGN KEY (organization_id, resource_id) REFERENCES scheduling.resources(organization_id, id),
  CHECK (start_local < end_local),
  UNIQUE (organization_id, resource_id, weekday, start_local)
);
CREATE TABLE scheduling.date_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  resource_id uuid NOT NULL,
  local_date date NOT NULL,
  closed boolean NOT NULL DEFAULT true,
  start_local time,
  end_local time,
  FOREIGN KEY (organization_id, resource_id) REFERENCES scheduling.resources(organization_id, id),
  CHECK ((closed AND start_local IS NULL AND end_local IS NULL) OR (NOT closed AND start_local IS NOT NULL AND end_local IS NOT NULL AND start_local < end_local)),
  UNIQUE (organization_id, resource_id, local_date)
);

-- Imported source truth is retained even when overlapping source records require
-- manual resolution; failure to reserve imported occupancy must block cutover.
CREATE TABLE scheduling.square_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  seller_id text NOT NULL,
  location_id text NOT NULL,
  square_booking_id text NOT NULL,
  source_version bigint,
  source_updated_at timestamptz,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  timezone text NOT NULL,
  status text NOT NULL,
  service_snapshot jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(service_snapshot) = 'array'),
  customer_data_encrypted bytea,
  synced_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (starts_at < ends_at),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, seller_id, location_id, square_booking_id)
);
CREATE INDEX square_bookings_calendar_idx ON scheduling.square_bookings(organization_id, starts_at);

CREATE TABLE scheduling.reconciliation_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  seller_id text NOT NULL,
  location_id text NOT NULL,
  range_start timestamptz NOT NULL,
  range_end timestamptz NOT NULL,
  sync_state text NOT NULL CHECK (sync_state IN ('running','complete','stale','failed','conflicted')),
  imported_count integer NOT NULL DEFAULT 0 CHECK (imported_count >= 0),
  updated_count integer NOT NULL DEFAULT 0 CHECK (updated_count >= 0),
  cancelled_count integer NOT NULL DEFAULT 0 CHECK (cancelled_count >= 0),
  conflict_count integer NOT NULL DEFAULT 0 CHECK (conflict_count >= 0),
  gap_count integer NOT NULL DEFAULT 0 CHECK (gap_count >= 0),
  finished_at timestamptz,
  approved_at timestamptz,
  approved_by text REFERENCES public.app_users(id),
  details jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(details) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (range_start < range_end),
  CHECK (approved_at IS NULL OR (sync_state = 'complete' AND finished_at IS NOT NULL AND conflict_count = 0 AND gap_count = 0 AND approved_by IS NOT NULL)),
  UNIQUE (organization_id, id)
);
CREATE INDEX reconciliation_org_created_idx ON scheduling.reconciliation_reports(organization_id, created_at DESC);
CREATE INDEX reconciliation_approved_by_fk_idx ON scheduling.reconciliation_reports(approved_by);
ALTER TABLE scheduling.settings ADD CONSTRAINT settings_report_fk
  FOREIGN KEY (organization_id, migration_approved_report_id) REFERENCES scheduling.reconciliation_reports(organization_id, id);
CREATE INDEX settings_report_fk_idx ON scheduling.settings(organization_id, migration_approved_report_id);

-- One capacity ledger for holds, first-party bookings, imported Square times and
-- private blocks. Adjacent [start,end) periods are allowed; overlaps are rejected.
CREATE TABLE scheduling.occupancy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  resource_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('hold','first_party','square_import','block')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  occupied tstzrange GENERATED ALWAYS AS (tstzrange(starts_at, ends_at, '[)')) STORED,
  active boolean NOT NULL DEFAULT true,
  expires_at timestamptz,
  capability_hash text UNIQUE,
  quote_snapshot jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(quote_snapshot) = 'object'),
  square_source_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, resource_id) REFERENCES scheduling.resources(organization_id, id),
  FOREIGN KEY (organization_id, square_source_id) REFERENCES scheduling.square_bookings(organization_id, id),
  CHECK (starts_at < ends_at),
  CHECK (kind <> 'hold' OR (expires_at IS NOT NULL AND capability_hash IS NOT NULL)),
  CHECK (kind <> 'square_import' OR square_source_id IS NOT NULL),
  UNIQUE (organization_id, id),
  EXCLUDE USING gist (organization_id WITH =, resource_id WITH =, occupied WITH &&) WHERE (active)
);
CREATE INDEX occupancy_resource_fk_idx ON scheduling.occupancy(organization_id, resource_id);
CREATE UNIQUE INDEX occupancy_square_source_idx ON scheduling.occupancy(organization_id, square_source_id) WHERE square_source_id IS NOT NULL;
CREATE INDEX occupancy_expiring_idx ON scheduling.occupancy(organization_id, expires_at) WHERE active AND kind = 'hold';

CREATE TABLE scheduling.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  occupancy_id uuid NOT NULL,
  confirmation_reference text NOT NULL UNIQUE,
  customer_data_encrypted bytea NOT NULL,
  marketing_consent boolean NOT NULL DEFAULT false,
  marketing_consent_context jsonb,
  status text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled')),
  cancelled_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, occupancy_id) REFERENCES scheduling.occupancy(organization_id, id),
  UNIQUE (organization_id, occupancy_id),
  CHECK (NOT marketing_consent OR marketing_consent_context IS NOT NULL)
);
CREATE INDEX bookings_org_created_idx ON scheduling.bookings(organization_id, created_at DESC);

CREATE TABLE scheduling.idempotency_records (
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  operation text NOT NULL CHECK (operation IN ('hold','confirm','cancel','reschedule')),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 16 AND 128),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  result jsonb NOT NULL CHECK (jsonb_typeof(result) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (organization_id, operation, idempotency_key)
);
CREATE TABLE scheduling.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  actor_user_id text REFERENCES public.app_users(id),
  event_type text NOT NULL CHECK (length(event_type) BETWEEN 1 AND 100),
  resource_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_org_created_idx ON scheduling.audit_events(organization_id, created_at DESC);
CREATE INDEX audit_actor_fk_idx ON scheduling.audit_events(actor_user_id);

-- Private schema is not exposed through PostgREST. RLS additionally requires a
-- server-set organization context; no browser role receives these privileges.
DO $security$
DECLARE item record;
BEGIN
  FOR item IN SELECT tablename FROM pg_tables WHERE schemaname = 'scheduling' LOOP
    EXECUTE format('ALTER TABLE scheduling.%I ENABLE ROW LEVEL SECURITY', item.tablename);
    EXECUTE format($policy$CREATE POLICY backend_organization_context ON scheduling.%I USING (organization_id::text = nullif(current_setting('mya.organization_id', true), '')) WITH CHECK (organization_id::text = nullif(current_setting('mya.organization_id', true), ''))$policy$, item.tablename);
    EXECUTE format('REVOKE ALL ON TABLE scheduling.%I FROM PUBLIC', item.tablename);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON public.organizations, public.app_users, public.organization_memberships, public.jobs, public.schema_migrations FROM anon;
    REVOKE ALL ON SCHEMA scheduling FROM anon;
    REVOKE ALL ON ALL TABLES IN SCHEMA scheduling FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.organizations, public.app_users, public.organization_memberships, public.jobs, public.schema_migrations FROM authenticated;
    REVOKE ALL ON SCHEMA scheduling FROM authenticated;
    REVOKE ALL ON ALL TABLES IN SCHEMA scheduling FROM authenticated;
  END IF;
END $security$;

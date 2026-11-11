CREATE TABLE public.organizations (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  timezone text NOT NULL DEFAULT 'UTC',
  enabled_modules jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(enabled_modules) = 'object'),
  workflow_settings jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(workflow_settings) = 'object'),
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.app_users (
  id text PRIMARY KEY CHECK (length(id) BETWEEN 1 AND 255),
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.organization_memberships (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  user_id text NOT NULL REFERENCES public.app_users(id) ON DELETE RESTRICT,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE INDEX organization_memberships_active_user_idx
  ON public.organization_memberships (user_id, organization_id)
  WHERE revoked_at IS NULL;

CREATE TABLE public.jobs (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE RESTRICT,
  queue_name text NOT NULL CHECK (queue_name ~ '^[a-z][a-z0-9_-]{0,62}$'),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(payload) = 'object'),
  dedupe_key text,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 20),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_expires_at timestamptz,
  locked_by text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  CHECK (
    (status = 'running' AND lease_expires_at IS NOT NULL AND locked_by IS NOT NULL)
    OR (status <> 'running' AND lease_expires_at IS NULL AND locked_by IS NULL)
  ),
  UNIQUE (organization_id, queue_name, dedupe_key)
);

CREATE INDEX jobs_ready_idx
  ON public.jobs (queue_name, available_at, created_at)
  WHERE status = 'queued';

CREATE SCHEMA IF NOT EXISTS drafting;
CREATE TABLE IF NOT EXISTS drafting.migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS drafting.profiles (
  user_id text PRIMARY KEY, preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS drafting.riot_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL REFERENCES drafting.profiles ON DELETE CASCADE,
  puuid text NOT NULL, game_name text NOT NULL, tag_line text NOT NULL, platform text NOT NULL,
  identity_kind text NOT NULL DEFAULT 'declared' CHECK(identity_kind IN ('declared','rso')),
  rank_data jsonb, mastery jsonb, refreshed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, puuid, platform)
);
CREATE TABLE IF NOT EXISTS drafting.champions (id text PRIMARY KEY, riot_key integer UNIQUE NOT NULL, name text NOT NULL, tags jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS drafting.patches (patch text PRIMARY KEY, discovered_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS drafting.matches (
  id text PRIMARY KEY, patch text NOT NULL, platform text NOT NULL, queue integer NOT NULL,
  started_at timestamptz NOT NULL, duration integer NOT NULL CHECK(duration>=300),
  bans jsonb NOT NULL DEFAULT '[]', source text NOT NULL DEFAULT 'Riot Match-V5',
  imported_at timestamptz NOT NULL DEFAULT now(), timeline_status text NOT NULL DEFAULT 'pending',
  UNIQUE(id, platform)
);
CREATE INDEX IF NOT EXISTS matches_context_idx ON drafting.matches(platform,queue,patch,started_at DESC);
CREATE INDEX IF NOT EXISTS matches_recent_idx ON drafting.matches(started_at DESC);
CREATE TABLE IF NOT EXISTS drafting.participants (
  match_id text NOT NULL REFERENCES drafting.matches ON DELETE CASCADE, participant_id integer NOT NULL,
  player_hash text NOT NULL, champion text NOT NULL, role text NOT NULL, team integer NOT NULL, win boolean NOT NULL,
  kills integer NOT NULL, deaths integer NOT NULL, assists integer NOT NULL, cs integer NOT NULL,
  damage integer NOT NULL, vision integer NOT NULL, kp real NOT NULL, objectives integer NOT NULL,
  gold15 integer, xp15 integer, gd15 integer, xpd15 integer,
  rank_tier text, rank_observed_at timestamptz,
  PRIMARY KEY(match_id,participant_id)
);
CREATE INDEX IF NOT EXISTS participants_player_idx ON drafting.participants(player_hash,match_id);
CREATE INDEX IF NOT EXISTS participants_champ_role_idx ON drafting.participants(champion,role,match_id);
CREATE TABLE IF NOT EXISTS drafting.timeline_metrics (
  match_id text NOT NULL REFERENCES drafting.matches ON DELETE CASCADE, participant_id integer NOT NULL,
  minute integer NOT NULL, gold integer NOT NULL, xp integer NOT NULL, cs integer NOT NULL,
  PRIMARY KEY(match_id,participant_id,minute)
);
CREATE TABLE IF NOT EXISTS drafting.drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL REFERENCES drafting.profiles ON DELETE CASCADE,
  name text NOT NULL DEFAULT 'Ma draft', state jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS drafts_owner_idx ON drafting.drafts(user_id,updated_at DESC);
CREATE TABLE IF NOT EXISTS drafting.jobs (
  key text PRIMARY KEY, kind text NOT NULL, payload jsonb NOT NULL, cursor integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0, last_error text,
  available_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS drafting.cache (
  key text PRIMARY KEY, value jsonb NOT NULL, expires_at timestamptz NOT NULL,
  source text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cache_expiry_idx ON drafting.cache(expires_at);
CREATE TABLE IF NOT EXISTS drafting.usage (
  subject text NOT NULL, bucket bigint NOT NULL, count integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
  PRIMARY KEY(subject,bucket)
);
CREATE TABLE IF NOT EXISTS drafting.provider_status (
  provider text PRIMARY KEY, status text NOT NULL, details jsonb NOT NULL DEFAULT '{}', checked_at timestamptz NOT NULL DEFAULT now()
);
-- Future predictive models are disabled until held-out calibration gates pass.
CREATE TABLE IF NOT EXISTS drafting.models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version text UNIQUE NOT NULL, context jsonb NOT NULL,
  artifact jsonb NOT NULL, train_end timestamptz NOT NULL, validation_end timestamptz NOT NULL,
  test_end timestamptz NOT NULL, metrics jsonb NOT NULL, active boolean NOT NULL DEFAULT false,
  CHECK(train_end < validation_end AND validation_end < test_end), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS drafting.predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), model_id uuid NOT NULL REFERENCES drafting.models,
  draft_hash text NOT NULL, probability real NOT NULL CHECK(probability BETWEEN 0 AND 1),
  context jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS predictions_draft_model_idx ON drafting.predictions(model_id,draft_hash);
-- Defense in depth for direct SQL/Data API roles. The server also scopes every private query by verified user ID.
ALTER TABLE drafting.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE drafting.riot_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE drafting.drafts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='drafting' AND tablename='profiles' AND policyname='own_profile') THEN
    CREATE POLICY own_profile ON drafting.profiles USING(user_id=current_setting('app.user_id',true)) WITH CHECK(user_id=current_setting('app.user_id',true));
    CREATE POLICY own_accounts ON drafting.riot_accounts USING(user_id=current_setting('app.user_id',true)) WITH CHECK(user_id=current_setting('app.user_id',true));
    CREATE POLICY own_drafts ON drafting.drafts USING(user_id=current_setting('app.user_id',true)) WITH CHECK(user_id=current_setting('app.user_id',true));
  END IF;
END $$;
INSERT INTO drafting.migrations(version) VALUES ('001') ON CONFLICT DO NOTHING;

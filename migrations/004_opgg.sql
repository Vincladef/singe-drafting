CREATE TABLE IF NOT EXISTS drafting.player_accounts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL REFERENCES drafting.profiles ON DELETE CASCADE,
 game_name text NOT NULL, tag_line text NOT NULL, platform text NOT NULL,
 identity_kind text NOT NULL DEFAULT 'declared' CHECK(identity_kind='declared'),
 rank_data jsonb, summary jsonb, refreshed_at timestamptz, last_attempt_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(user_id,game_name,tag_line,platform)
);
INSERT INTO drafting.player_accounts(id,user_id,game_name,tag_line,platform,created_at)
SELECT id,user_id,game_name,tag_line,platform,created_at FROM drafting.riot_accounts ON CONFLICT DO NOTHING;
-- Retire the former queue; no new code executes these jobs or trains the raw-match models.
UPDATE drafting.jobs SET status='retired',updated_at=now() WHERE status<>'retired';
UPDATE drafting.models SET active=false WHERE active=true;
ALTER TABLE drafting.player_accounts ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='drafting' AND tablename='player_accounts' AND policyname='own_player_accounts') THEN
 CREATE POLICY own_player_accounts ON drafting.player_accounts USING(user_id=current_setting('app.user_id',true)) WITH CHECK(user_id=current_setting('app.user_id',true));
 END IF;
END $$;
INSERT INTO drafting.migrations(version) VALUES('004_opgg') ON CONFLICT DO NOTHING;

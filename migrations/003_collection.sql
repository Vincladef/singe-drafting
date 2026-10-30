CREATE TABLE IF NOT EXISTS drafting.worker_leases(name text PRIMARY KEY,owner uuid NOT NULL,expires_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS participants_role_champion_idx ON drafting.participants(role,champion,match_id);
INSERT INTO drafting.migrations(version) VALUES('003') ON CONFLICT DO NOTHING;

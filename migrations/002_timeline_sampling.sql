ALTER TABLE drafting.timeline_metrics ADD COLUMN IF NOT EXISTS sampled_at_ms integer;
UPDATE drafting.matches SET timeline_status='pending' WHERE duration>=900 AND NOT EXISTS (SELECT 1 FROM drafting.timeline_metrics t WHERE t.match_id=drafting.matches.id) AND NOT EXISTS(SELECT 1 FROM drafting.migrations WHERE version='002');
INSERT INTO drafting.migrations(version) VALUES ('002') ON CONFLICT DO NOTHING;

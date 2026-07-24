ALTER TABLE matches
  DROP CONSTRAINT IF EXISTS matches_status_check;

ALTER TABLE matches
  ADD COLUMN IF NOT EXISTS winner_side TEXT,
  ADD COLUMN IF NOT EXISTS result_reason TEXT NOT NULL DEFAULT 'unknown';

ALTER TABLE matches
  ALTER COLUMN score_a DROP DEFAULT,
  ALTER COLUMN score_b DROP DEFAULT;

UPDATE matches
   SET winner_side = CASE
         WHEN score_a IS NOT NULL AND score_b IS NOT NULL AND score_a > score_b THEN 'team1'
         WHEN score_a IS NOT NULL AND score_b IS NOT NULL AND score_b > score_a THEN 'team2'
         ELSE NULL
       END,
       result_reason = CASE
         WHEN score_a IS NOT NULL AND score_b IS NOT NULL AND score_a <> score_b THEN 'normal'
         ELSE 'unknown'
       END
 WHERE status = 'finished'
   AND winner_side IS NULL;

ALTER TABLE matches
  ADD CONSTRAINT matches_status_check
    CHECK (status IN ('scheduled','running','finished','postponed','cancelled')),
  ADD CONSTRAINT matches_winner_side_check
    CHECK (winner_side IS NULL OR winner_side IN ('team1','team2','draw')),
  ADD CONSTRAINT matches_result_reason_check
    CHECK (result_reason IN ('normal','walkover','forfeit','cancelled','postponed','unknown')),
  ADD CONSTRAINT matches_lifecycle_outcome_check
    CHECK (
      (status IN ('scheduled','running') AND winner_side IS NULL AND result_reason = 'unknown')
      OR (status = 'postponed' AND winner_side IS NULL AND result_reason = 'postponed')
      OR (status = 'cancelled' AND winner_side IS NULL AND result_reason = 'cancelled')
      OR (status = 'finished' AND result_reason IN ('normal','walkover','forfeit','unknown'))
    );

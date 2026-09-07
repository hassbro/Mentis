ALTER TABLE game_state 
ADD COLUMN IF NOT EXISTS used_categories INTEGER[] DEFAULT ARRAY[]::INTEGER[];

COMMENT ON COLUMN game_state.used_categories IS 'Array of category IDs that have been used in previous rounds to prevent repetition';
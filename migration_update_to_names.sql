-- Update to track used categories by name instead of ID
-- This handles duplicate category entries with the same name

-- Drop the old column
ALTER TABLE game_state DROP COLUMN IF EXISTS used_categories;

-- Add the new column for names
ALTER TABLE game_state 
ADD COLUMN IF NOT EXISTS used_category_names TEXT[] DEFAULT ARRAY[]::TEXT[];

COMMENT ON COLUMN game_state.used_category_names IS 'Array of category names that have been used in previous rounds to prevent repetition';
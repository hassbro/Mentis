-- Add jeopardy_category_ids column to app_settings table
ALTER TABLE app_settings
ADD COLUMN IF NOT EXISTS jeopardy_category_ids INTEGER[] DEFAULT ARRAY[]::INTEGER[];

COMMENT ON COLUMN app_settings.jeopardy_category_ids IS 'Stores the category IDs selected for Jeopardy round to prevent repetition in Double Jeopardy';

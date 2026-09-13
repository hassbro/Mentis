-- Ensure the table exists first
CREATE TABLE IF NOT EXISTS app_settings (
    id SERIAL PRIMARY KEY
);

-- Add the column safely
ALTER TABLE app_settings
ADD COLUMN IF NOT EXISTS category_shuffle_ids INTEGER[] DEFAULT ARRAY[]::INTEGER[];

COMMENT ON COLUMN app_settings.category_shuffle_ids IS 'Stores the shuffled order of category IDs for random category selection across games while ensuring no repetition between Jeopardy and Double Jeopardy';

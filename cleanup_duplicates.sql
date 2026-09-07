-- Clean up duplicates in used_categories array
UPDATE game_state 
SET used_categories = ARRAY(SELECT DISTINCT unnest(used_categories))
WHERE id = 1;
-- Clear only the used_category_names column
UPDATE game_state 
SET used_category_names = ARRAY[]::TEXT[]
WHERE id = 1;
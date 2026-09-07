-- Check current state of categories and used_categories
SELECT id, name FROM categories ORDER BY name;

SELECT used_categories FROM game_state WHERE id = 1;

-- Check if categories table has duplicate names
SELECT name, COUNT(*) as count 
FROM categories 
GROUP BY name 
HAVING COUNT(*) > 1;
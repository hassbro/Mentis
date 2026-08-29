import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://geombemcixjalksdperh.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdlb21iZW1jaXhqYWxrc2RwZXJoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc2NjM2MzAsImV4cCI6MjEwMzIzOTYzMH0.Hn3bAfYX6zgAZtkmuFw3C-SlzXUc8hDw4_2VlAvquFs';

export const supabase = createClient(supabaseUrl, supabaseAnonKey)
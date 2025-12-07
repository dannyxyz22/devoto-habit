import { createClient, SupabaseClient } from '@supabase/supabase-js';

// These environment variables should be set in your .env file
// VITE_SUPABASE_URL
// VITE_SUPABASE_ANON_KEY

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

let supabase: SupabaseClient | null = null;

if (!supabaseUrl || !supabaseAnonKey) {
    console.warn('Supabase URL or Anon Key is missing. Auth and Cloud Sync features will not work.');
} else {
    supabase = createClient(supabaseUrl, supabaseAnonKey);
}

export { supabase };

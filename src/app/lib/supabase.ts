import { createClient } from "@supabase/supabase-js";

/**
 * Single shared Supabase client. Importing this anywhere returns the SAME
 * GoTrueClient instance, which avoids the "Multiple GoTrueClient instances
 * detected" warning and prevents auth state race conditions.
 */
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
  {
    auth: {
      // Custom storage key so different apps on the same origin don't collide.
      storageKey: "campusconnect-supabase-auth",
      persistSession: true,
      autoRefreshToken: true,
    },
  }
);

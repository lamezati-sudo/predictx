import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client — BYPASSES Row Level Security.
 * NEVER import this into client components. Use only inside server route
 * handlers / cron jobs that need to debit/credit balances or settle windows.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}

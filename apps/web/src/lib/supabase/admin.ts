import "server-only";

import { createClient } from "@supabase/supabase-js";
import { webEnv } from "@/env/web";

export function createSupabaseAdminClient() {
	return createClient(
		webEnv.NEXT_PUBLIC_SUPABASE_URL,
		webEnv.SUPABASE_SERVICE_ROLE_KEY,
		{
			auth: {
				autoRefreshToken: false,
				persistSession: false,
			},
		},
	);
}

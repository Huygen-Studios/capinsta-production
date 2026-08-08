"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let browserClient: SupabaseClient | undefined;

export function createClient(): SupabaseClient {
	if (!browserClient) {
		const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
		const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
		if (!url || !key) {
			throw new Error("Supabase public environment variables are not configured.");
		}
		browserClient = createBrowserClient(url, key);
	}
	return browserClient;
}

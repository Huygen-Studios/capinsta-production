import { NextResponse } from "next/server";
import { getBillingOverview } from "@/billing/entitlements";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
	const supabase = await createClient();
	const {
		data: { user },
		error,
	} = await supabase.auth.getUser();
	if (error || !user) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
	return NextResponse.json(await getBillingOverview(user.id));
}

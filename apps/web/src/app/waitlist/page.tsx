import { redirect } from "next/navigation";
import { getSiteAccessPolicy } from "@/access/server";
import { ComingSoonPage } from "@/components/access/access-pages";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function WaitlistPage() {
	const supabase = await createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();
	if (user) redirect("/");

	const policy = await getSiteAccessPolicy();
	return <ComingSoonPage policy={policy} />;
}

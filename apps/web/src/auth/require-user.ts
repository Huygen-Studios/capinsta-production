import { redirect } from "next/navigation";
import { resolvePostAuthDestination } from "@/access/server";
import { createClient } from "@/lib/supabase/server";
import { isUiTestAuthBypassEnabled, signInPathFor } from "./routes";

export async function requireUser(pathname: string) {
	if (isUiTestAuthBypassEnabled()) {
		return { id: "capinsta-ui-verification-user" };
	}
	const supabase = await createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();
	if (!user) redirect(signInPathFor(pathname));
	return user;
}

export async function redirectAuthenticatedUser(destination = "/projects") {
	if (isUiTestAuthBypassEnabled()) redirect(destination);
	const supabase = await createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();
	if (user) redirect(await resolvePostAuthDestination(user.id, destination));
}

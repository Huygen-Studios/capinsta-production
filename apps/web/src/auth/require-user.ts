import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { signInPathFor } from "./routes";

export async function requireUser(pathname: string) {
	const supabase = await createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();
	if (!user) redirect(signInPathFor(pathname));
	return user;
}

"use client";

import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export function AccessSignOutButton() {
	const router = useRouter();
	return (
		<Button
			variant="outline"
			onClick={async () => {
				await createClient().auth.signOut({ scope: "global" });
				router.replace("/");
				router.refresh();
			}}
		>
			Sign out
		</Button>
	);
}

"use client";

import { useState } from "react";
import { readableAuthError } from "@/auth/messages";
import { isSafeInternalPath } from "@/auth/routes";
import { createClient } from "@/lib/supabase/client";
import { secondaryAuthButtonClass } from "./auth-shell";

export function GoogleButton({
	redirectPath,
	onError,
}: {
	redirectPath: string;
	onError: (message: string) => void;
}) {
	const [loading, setLoading] = useState(false);

	const signIn = async () => {
		if (loading) return;
		setLoading(true);
		onError("");
		const next = isSafeInternalPath(redirectPath);
		const origin =
			process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ||
			window.location.origin;
		const { error } = await createClient().auth.signInWithOAuth({
			provider: "google",
			options: {
				redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
			},
		});
		if (error) {
			onError(readableAuthError(error, "Unable to start Google sign-in."));
			setLoading(false);
		}
	};

	return (
		<button
			type="button"
			className={secondaryAuthButtonClass}
			onClick={() => void signIn()}
			disabled={loading}
		>
			<span className="text-base font-bold text-white">G</span>
			{loading ? "Connecting..." : "Continue with Google"}
		</button>
	);
}

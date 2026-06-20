"use client";

import Link from "next/link";
import { useState } from "react";
import { readableAuthError } from "@/auth/messages";
import { createClient } from "@/lib/supabase/client";
import { AuthError, AuthShell, authInputClass, primaryAuthButtonClass } from "@/components/auth/auth-shell";

export function ForgotPasswordForm() {
	const [email, setEmail] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [sent, setSent] = useState(false);

	const submit = async (event: React.FormEvent) => {
		event.preventDefault();
		if (loading) return;
		if (!email.includes("@")) return setError("Enter a valid email address.");
		setLoading(true);
		setError(null);
		const origin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") || window.location.origin;
		const { error: resetError } = await createClient().auth.resetPasswordForEmail(email.trim(), {
			redirectTo: `${origin}/reset-password`,
		});
		if (resetError) {
			setError(readableAuthError(resetError, "Unable to send a reset link. Please try again."));
			setLoading(false);
			return;
		}
		setSent(true);
		setLoading(false);
	};

	if (sent) {
		return (
			<AuthShell title="Check your email" description="If an account exists for this address, we sent a password reset link.">
				<Link href="/sign-in" className={primaryAuthButtonClass}>Back to sign in</Link>
			</AuthShell>
		);
	}

	return (
		<AuthShell title="Forgot password?" description="Enter your email and we’ll send you a secure reset link.">
			<AuthError message={error} />
			<form className="mt-4 space-y-4" onSubmit={(event) => void submit(event)}>
				<label htmlFor="email" className="block text-sm font-medium text-zinc-200">
					Email address
					<input id="email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} className={authInputClass} required />
				</label>
				<button className={primaryAuthButtonClass} disabled={loading}>{loading ? "Sending..." : "Send reset link"}</button>
			</form>
			<p className="mt-5 text-center text-sm"><Link href="/sign-in" className="text-violet-400 hover:text-violet-300">Back to sign in</Link></p>
		</AuthShell>
	);
}

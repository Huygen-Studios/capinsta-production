"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { readableAuthError } from "@/auth/messages";
import { createClient } from "@/lib/supabase/client";
import {
	AuthError,
	AuthShell,
	authInputClass,
	primaryAuthButtonClass,
} from "@/components/auth/auth-shell";
import { GoogleButton } from "@/components/auth/google-button";
import { PasswordField } from "@/components/auth/password-field";

export function SignInForm({
	redirectPath,
	initialError,
}: {
	redirectPath: string;
	initialError: string | null;
}) {
	const router = useRouter();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(
		initialError ? "Unable to sign in. Please try again." : null,
	);

	const submit = async (event: React.FormEvent) => {
		event.preventDefault();
		if (loading) return;
		setError(null);
		if (!email.includes("@")) {
			setError("Enter a valid email address.");
			return;
		}
		setLoading(true);
		const { error: signInError } = await createClient().auth.signInWithPassword({
			email: email.trim(),
			password,
		});
		if (signInError) {
			setError(readableAuthError(signInError, "Unable to sign in. Please try again."));
			setLoading(false);
			return;
		}
		router.replace(`/auth/resolve?next=${encodeURIComponent(redirectPath)}`);
		router.refresh();
	};

	return (
		<AuthShell
			title="Welcome back"
			description="Sign in to open your projects and continue editing."
		>
			<div className="space-y-5">
				<GoogleButton redirectPath={redirectPath} onError={setError} />
				<div className="flex items-center gap-3 text-xs text-muted-foreground">
					<div className="h-px flex-1 bg-border" />
					or
					<div className="h-px flex-1 bg-border" />
				</div>
				<AuthError message={error} />
				<form className="space-y-4" onSubmit={(event) => void submit(event)}>
					<label htmlFor="email" className="block text-sm font-semibold text-foreground">
						Email
						<input
							id="email"
							type="email"
							autoComplete="email"
							value={email}
							onChange={(event) => setEmail(event.target.value)}
							required
							className={authInputClass}
						/>
					</label>
					<PasswordField
						id="password"
						label="Password"
						value={password}
						onChange={setPassword}
						autoComplete="current-password"
					/>
					<div className="text-right">
						<Link href="/forgot-password" className="text-sm font-semibold text-primary hover:underline">
							Forgot password?
						</Link>
					</div>
					<button className={primaryAuthButtonClass} disabled={loading}>
						{loading ? "Signing in..." : "Sign in"}
					</button>
				</form>
				<p className="text-center text-sm text-muted-foreground">
					New to Capinsta?{" "}
					<Link
						href={`/sign-up?redirect=${encodeURIComponent(redirectPath)}`}
						className="font-semibold text-primary hover:underline"
					>
						Create an account
					</Link>
				</p>
			</div>
		</AuthShell>
	);
}

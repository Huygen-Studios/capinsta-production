"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { readableAuthError } from "@/auth/messages";
import { PASSWORD_POLICY, validatePassword } from "@/auth/password-policy";
import { createClient } from "@/lib/supabase/client";
import { AuthError, AuthShell, primaryAuthButtonClass } from "@/components/auth/auth-shell";
import { PasswordField } from "@/components/auth/password-field";

export function ResetPasswordForm() {
	const [ready, setReady] = useState(false);
	const [invalid, setInvalid] = useState(false);
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");
	const [loading, setLoading] = useState(false);
	const [success, setSuccess] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		const supabase = createClient();
		const restore = async () => {
			const code = new URL(window.location.href).searchParams.get("code");
			if (code) {
				const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
				if (exchangeError) return setInvalid(true);
				window.history.replaceState({}, "", "/reset-password");
			}
			const { data } = await supabase.auth.getSession();
			if (!data.session) setInvalid(true);
			else setReady(true);
		};
		void restore();
	}, []);

	const submit = async (event: React.FormEvent) => {
		event.preventDefault();
		if (loading) return;
		const passwordError = validatePassword(password);
		if (passwordError) return setError(passwordError);
		if (password !== confirmPassword) return setError("Passwords do not match.");
		setLoading(true);
		setError(null);
		const { error: updateError } = await createClient().auth.updateUser({ password });
		if (updateError) {
			setError(readableAuthError(updateError, "Unable to update your password."));
			setLoading(false);
			return;
		}
		setSuccess(true);
		setLoading(false);
	};

	if (invalid) {
		return (
			<AuthShell title="Reset link expired" description="This password reset link is invalid or has expired.">
				<Link href="/forgot-password" className={primaryAuthButtonClass}>Request another reset email</Link>
			</AuthShell>
		);
	}
	if (!ready) {
		return <AuthShell title="Checking your link" description="Securely restoring your password recovery session…"><div className="h-2 animate-pulse rounded bg-primary/50" /></AuthShell>;
	}
	if (success) {
		return (
			<AuthShell title="Password updated" description="Your new password is ready to use.">
				<Link href="/projects" className={primaryAuthButtonClass}>Continue to projects</Link>
			</AuthShell>
		);
	}
	return (
		<AuthShell title="Set a new password" description="Choose a strong password you have not used before.">
			<AuthError message={error} />
			<form className="mt-4 space-y-4" onSubmit={(event) => void submit(event)}>
				<PasswordField
					id="password"
					label="New password"
					value={password}
					onChange={setPassword}
					autoComplete="new-password"
					hint={PASSWORD_POLICY.requirementsMessage}
				/>
				<PasswordField id="confirm-password" label="Confirm password" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />
				<button className={primaryAuthButtonClass} disabled={loading}>{loading ? "Updating..." : "Update password"}</button>
			</form>
		</AuthShell>
	);
}

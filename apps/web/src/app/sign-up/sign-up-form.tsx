"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { readableAuthError } from "@/auth/messages";
import { PASSWORD_POLICY, validatePassword } from "@/auth/password-policy";
import { createClient } from "@/lib/supabase/client";
import {
  AuthError,
  AuthShell,
  authInputClass,
  primaryAuthButtonClass,
} from "@/components/auth/auth-shell";
import { GoogleButton } from "@/components/auth/google-button";
import { PasswordField } from "@/components/auth/password-field";

export function SignUpForm({
  redirectPath,
  registrationEnabled,
}: {
  redirectPath: string;
  registrationEnabled: boolean;
}) {
  const router = useRouter();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState(false);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (loading) return;
    if (!registrationEnabled)
      return setError("Registration is temporarily unavailable.");
    setError(null);
    if (!fullName.trim()) return setError("Enter your full name.");
    if (!email.includes("@")) return setError("Enter a valid email address.");
    const passwordError = validatePassword(password);
    if (passwordError) return setError(passwordError);
    if (password !== confirmPassword)
      return setError("Passwords do not match.");

    setLoading(true);
    const origin =
      process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/+$/, "") ||
      window.location.origin;
    const { data, error: signUpError } = await createClient().auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { full_name: fullName.trim() },
        emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(redirectPath)}`,
      },
    });
    if (signUpError) {
      setError(
        readableAuthError(signUpError, "Unable to create your account."),
      );
      setLoading(false);
      return;
    }
    if (!data.session) {
      setCheckEmail(true);
      setLoading(false);
      return;
    }
    router.replace(`/auth/resolve?next=${encodeURIComponent(redirectPath)}`);
    router.refresh();
  };

  if (checkEmail) {
    return (
      <AuthShell
        title="Check your email"
        description="We sent you a verification link. Open it to finish creating your Capinsta account."
      >
        <Link href="/sign-in" className={primaryAuthButtonClass}>
          Back to sign in
        </Link>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Create your account"
      description="Your projects, uploads, captions, and exports stay tied to your account."
    >
      <div className="space-y-5">
        {registrationEnabled ? (
          <GoogleButton redirectPath={redirectPath} onError={setError} />
        ) : null}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <div className="h-px flex-1 bg-border" />
          or
          <div className="h-px flex-1 bg-border" />
        </div>
        <AuthError message={error} />
        <form className="space-y-4" onSubmit={(event) => void submit(event)}>
          <label
            htmlFor="full-name"
            className="block text-sm font-semibold text-foreground"
          >
            Full name
            <input
              id="full-name"
              autoComplete="name"
              value={fullName}
              onChange={(event) => setFullName(event.target.value)}
              required
              className={authInputClass}
            />
          </label>
          <label
            htmlFor="email"
            className="block text-sm font-semibold text-foreground"
          >
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
            autoComplete="new-password"
            hint={PASSWORD_POLICY.requirementsMessage}
          />
          <PasswordField
            id="confirm-password"
            label="Confirm password"
            value={confirmPassword}
            onChange={setConfirmPassword}
            autoComplete="new-password"
          />
          <button
            className={primaryAuthButtonClass}
            disabled={loading || !registrationEnabled}
          >
            {loading ? "Creating account..." : "Create account"}
          </button>
        </form>
        <p className="text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            href={`/sign-in?redirect=${encodeURIComponent(redirectPath)}`}
            className="font-semibold text-primary hover:underline"
          >
            Sign in
          </Link>
        </p>
      </div>
    </AuthShell>
  );
}

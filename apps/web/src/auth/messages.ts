/* eslint-disable opencut/prefer-object-params -- Auth error adapters mirror Supabase callback signatures. */
import type { AuthError } from "@supabase/supabase-js";

export function readableAuthError(
	error: AuthError | Error | null | undefined,
	fallback = "Unable to complete this request. Please try again.",
): string {
	const message = error?.message.toLowerCase() ?? "";

	if (
		message.includes("invalid login credentials") ||
		message.includes("invalid email or password")
	) {
		return "Invalid email or password.";
	}
	if (message.includes("email not confirmed")) {
		return "Please verify your email before signing in.";
	}
	if (message.includes("user already registered")) {
		return "An account with this email already exists.";
	}
	if (message.includes("rate limit") || message.includes("too many")) {
		return "Too many attempts. Please try again later.";
	}
	if (
		message.includes("expired") ||
		message.includes("invalid") ||
		message.includes("pkce")
	) {
		return "This authentication link is invalid or has expired.";
	}
	if (message.includes("password")) {
		return "Please use a stronger password with at least 8 characters.";
	}
	return fallback;
}

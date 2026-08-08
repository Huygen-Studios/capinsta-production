import "server-only";

import type { User } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { profiles } from "@/db/schema";

function displayNameForUser(user: User) {
	const metadata = user.user_metadata;
	const value =
		metadata?.display_name ?? metadata?.full_name ?? metadata?.name ?? null;
	return typeof value === "string" && value.trim() ? value.trim() : null;
}

function providerForUser(user: User) {
	const provider =
		user.app_metadata?.provider ??
		user.identities?.[0]?.provider ??
		(user.is_anonymous ? "anonymous" : null);
	return typeof provider === "string" && provider.trim() ? provider : null;
}

function dateFromIso(value: string | null | undefined) {
	return value ? new Date(value) : null;
}

export async function provisionAuthenticatedUser(user: User) {
	const now = new Date();
	await db
		.insert(profiles)
		.values({
			userId: user.id,
			emailSnapshot: user.email ?? null,
			displayName: displayNameForUser(user),
			productAccessStatus: "pending",
			authProviderSnapshot: providerForUser(user),
			emailConfirmedAt: dateFromIso(user.email_confirmed_at),
			lastSignInAt: dateFromIso(user.last_sign_in_at),
			createdAt: dateFromIso(user.created_at) ?? now,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: profiles.userId,
			set: {
				emailSnapshot: user.email ?? null,
				displayName: displayNameForUser(user),
				authProviderSnapshot: providerForUser(user),
				emailConfirmedAt: dateFromIso(user.email_confirmed_at),
				lastSignInAt: dateFromIso(user.last_sign_in_at),
				updatedAt: now,
			},
		});

	const [profile] = await db
		.select({ userId: profiles.userId })
		.from(profiles)
		.where(eq(profiles.userId, user.id))
		.limit(1);
	if (!profile) throw new Error("profile_provisioning_missing_after_upsert");
}

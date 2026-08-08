import "server-only";

import { unstable_cache } from "next/cache";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { featureFlags, systemSettings } from "@/db/schema";

export const getRuntimeConfiguration = unstable_cache(
	async () => {
		const [flags, settings] = await Promise.all([
			db.select().from(featureFlags),
			db.select().from(systemSettings),
		]);
		return {
			flags: Object.fromEntries(flags.map((flag) => [flag.key, flag])),
			settings: Object.fromEntries(
				settings.map((setting) => [setting.key, setting]),
			),
		};
	},
	["capinsta-runtime-config"],
	{ revalidate: 15, tags: ["runtime-config"] },
);

export async function isRuntimeFlagEnabled({
	key,
	fallback,
}: {
	key: string;
	fallback: boolean;
}) {
	const [flag] = await db
		.select({ enabled: featureFlags.enabled })
		.from(featureFlags)
		.where(eq(featureFlags.key, key))
		.limit(1);
	return flag?.enabled ?? fallback;
}

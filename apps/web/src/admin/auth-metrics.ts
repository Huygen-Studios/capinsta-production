import "server-only";

import type { User } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type AuthUserMetrics = {
	total: number;
	newInRange: number;
	dailyNewUsers: Array<{ date: string; value: number }>;
	latestUsers: Array<{ id: string; email: string | null; createdAt: string }>;
};

type ListUsers = (params: { page: number; perPage: number }) => Promise<{
	data: { users: User[] };
	error: { message: string; status?: number } | null;
}>;

export async function collectAuthUserMetrics({
	startUtc,
	endUtc,
	listUsers,
	perPage = 1000,
}: {
	startUtc: string;
	endUtc: string;
	listUsers: ListUsers;
	perPage?: number;
}): Promise<AuthUserMetrics> {
	const users: User[] = [];
	for (let page = 1; ; page += 1) {
		const { data, error } = await listUsers({ page, perPage });
		if (error) throw new Error(`supabase_auth_${error.status ?? "query"}`);
		users.push(...data.users);
		if (data.users.length < perPage) break;
	}
	const start = Date.parse(startUtc);
	const end = Date.parse(endUtc);
	const inRange = users.filter((user) => {
		const created = Date.parse(user.created_at);
		return created >= start && created < end;
	});
	const daily = new Map<string, number>();
	for (const user of inRange) {
		const date = new Date(user.created_at).toISOString().slice(0, 10);
		daily.set(date, (daily.get(date) ?? 0) + 1);
	}
	return {
		total: users.length,
		newInRange: inRange.length,
		dailyNewUsers: [...daily].sort(([left], [right]) => left.localeCompare(right))
			.map(([date, value]) => ({ date, value })),
		latestUsers: [...users]
			.sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
			.slice(0, 10)
			.map((user) => ({ id: user.id, email: user.email ?? null, createdAt: user.created_at })),
	};
}

export function querySupabaseAuthUserMetrics({ startUtc, endUtc }: { startUtc: string; endUtc: string }) {
	const client = createSupabaseAdminClient();
	return collectAuthUserMetrics({
		startUtc,
		endUtc,
		listUsers: (params) => client.auth.admin.listUsers(params),
	});
}

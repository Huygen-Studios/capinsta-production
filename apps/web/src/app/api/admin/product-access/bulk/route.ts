import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
	applyBulkProductAccess,
	previewBulkProductAccess,
} from "@/admin/product-access";
import {
	requireAdminPermission,
	requireRecentMfaForSensitiveAction,
	RecentMfaRequiredError,
} from "@/admin/auth";
import { requireCsrfProtection } from "@/auth/csrf";

const schema = z.object({
	userIds: z.array(z.uuid()).min(1).max(250),
	productIds: z.array(z.string().min(1).max(80)).min(1),
	action: z.enum(["grant", "revoke", "replace"]),
	reason: z.string().trim().min(8).max(1000),
	dryRun: z.boolean().optional(),
});

export async function POST(request: Request) {
	const csrf = requireCsrfProtection(request);
	if (csrf) return csrf;
	const parsed = schema.safeParse(await request.json().catch(() => null));
	if (!parsed.success)
		return NextResponse.json({ error: "Invalid request." }, { status: 400 });
	try {
		await requireAdminPermission(
			parsed.data.dryRun ? "access.read" : "access.manage_users",
		);
		if (parsed.data.dryRun) {
			return NextResponse.json({
				ok: true,
				preview: await previewBulkProductAccess(parsed.data),
			});
		}
		await requireRecentMfaForSensitiveAction();
		const idempotencyKey = request.headers.get("idempotency-key")?.trim();
		if (!idempotencyKey) {
			return NextResponse.json(
				{ error: "An idempotency key is required." },
				{ status: 400 },
			);
		}
		const context = await requireAdminPermission("access.manage_users");
		const outcome = await applyBulkProductAccess({
			...parsed.data,
			context,
			idempotencyKey,
		});
		revalidatePath("/");
		revalidatePath("/admincapinsta11/users");
		for (const userId of parsed.data.userIds.slice(0, 50)) {
			revalidatePath(`/admincapinsta11/users/${userId}`);
		}
		return NextResponse.json({ ok: true, outcome });
	} catch (error) {
		if (error instanceof RecentMfaRequiredError) {
			return NextResponse.json(
				{
					error: "A fresh MFA verification is required.",
					stepUp: "/admincapinsta11/mfa?step_up=1",
				},
				{ status: 428 },
			);
		}
		return NextResponse.json(
			{ error: error instanceof Error ? error.message : "bulk_access_failed" },
			{ status: 400 },
		);
	}
}

import { NextResponse } from "next/server";
import { z } from "zod";
import { getUserProductAccess, applyProductAccessForUser } from "@/admin/product-access";
import {
	requireAdminPermission,
	requireRecentMfaForSensitiveAction,
	RecentMfaRequiredError,
} from "@/admin/auth";
import { requireCsrfProtection } from "@/auth/csrf";
import { revalidatePath } from "next/cache";

const updateSchema = z.object({
	productIds: z.array(z.string().min(1).max(80)).min(1),
	action: z.enum(["grant", "revoke", "replace"]),
	reason: z.string().trim().min(8).max(1000),
});

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ userId: string }> },
) {
	await requireAdminPermission("access.read");
	const { userId } = await params;
	try {
		return NextResponse.json(await getUserProductAccess(userId));
	} catch {
		return NextResponse.json({ error: "User was not found." }, { status: 404 });
	}
}

export async function PUT(
	request: Request,
	{ params }: { params: Promise<{ userId: string }> },
) {
	const csrf = requireCsrfProtection(request);
	if (csrf) return csrf;
	const parsed = updateSchema.safeParse(await request.json().catch(() => null));
	if (!parsed.success)
		return NextResponse.json({ error: "Invalid request." }, { status: 400 });
	const { userId } = await params;
	try {
		const context = await requireAdminPermission("access.manage_users");
		await requireRecentMfaForSensitiveAction();
		const result = await applyProductAccessForUser({
			userId,
			productIds: parsed.data.productIds,
			action: parsed.data.action,
			reason: parsed.data.reason,
			context,
		});
		revalidatePath("/");
		revalidatePath("/admincapinsta11/users");
		revalidatePath(`/admincapinsta11/users/${userId}`);
		return NextResponse.json({
			ok: true,
			result,
			access: await getUserProductAccess(userId),
		});
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
			{ error: error instanceof Error ? error.message : "product_access_failed" },
			{ status: 400 },
		);
	}
}

import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireAdminPermission } from "@/admin/auth";
import { db } from "@/db";
import { appProductAccessBulkOperations } from "@/db/schema";

export async function GET(
	_request: Request,
	{ params }: { params: Promise<{ operationId: string }> },
) {
	await requireAdminPermission("access.read");
	const { operationId } = await params;
	const [operation] = await db
		.select()
		.from(appProductAccessBulkOperations)
		.where(eq(appProductAccessBulkOperations.id, operationId))
		.limit(1);
	if (!operation)
		return NextResponse.json({ error: "Operation was not found." }, { status: 404 });
	return NextResponse.json({ operation });
}

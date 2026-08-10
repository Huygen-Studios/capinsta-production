import { and, desc, eq, isNull, or, lte, gte } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, systemNotifications } from "@/db";

export const dynamic = "force-dynamic";
export async function GET() {
	const now = new Date();
	const [notification] = await db.select({ title: systemNotifications.title, severity: systemNotifications.severity, items: systemNotifications.items }).from(systemNotifications).where(and(eq(systemNotifications.enabled, true), or(isNull(systemNotifications.startsAt), lte(systemNotifications.startsAt, now)), or(isNull(systemNotifications.endsAt), gte(systemNotifications.endsAt, now)))).orderBy(desc(systemNotifications.updatedAt)).limit(1);
	return NextResponse.json(notification ?? null, { headers: { "Cache-Control": "public, max-age=30" } });
}

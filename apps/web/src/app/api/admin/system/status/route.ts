import { NextRequest, NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { requireAdminPermission } from "@/admin/auth";
import { requireCsrfProtection } from "@/auth/csrf";
import { db, systemNotifications } from "@/db";
const schema = z.object({ title: z.string().min(1).max(240), items: z.array(z.string().min(1).max(500)).max(8), severity: z.enum(["warning", "error", "info"]).default("warning"), enabled: z.boolean().default(true), startsAt: z.string().datetime().nullable().optional(), endsAt: z.string().datetime().nullable().optional() });
export async function GET() { try { await requireAdminPermission("system.read"); } catch { return NextResponse.json({ error: "Forbidden" }, { status: 403 }); } return NextResponse.json(await db.select().from(systemNotifications).orderBy(desc(systemNotifications.updatedAt))); }
export async function POST(request: NextRequest) { const csrf = requireCsrfProtection(request); if (csrf) return csrf; let admin; try { admin = await requireAdminPermission("system.manage_limits"); } catch { return NextResponse.json({ error: "Forbidden" }, { status: 403 }); } const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return NextResponse.json({ error: "Invalid notification" }, { status: 400 }); const [created] = await db.insert(systemNotifications).values({ ...parsed.data, startsAt: parsed.data.startsAt ? new Date(parsed.data.startsAt) : null, endsAt: parsed.data.endsAt ? new Date(parsed.data.endsAt) : null, createdBy: admin.userId }).returning(); return NextResponse.json(created, { status: 201 }); }

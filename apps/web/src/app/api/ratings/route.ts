import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCsrfProtection } from "@/auth/csrf";
import { db, userRatings } from "@/db";
import { createClient } from "@/lib/supabase/server";
import { desc, eq } from "drizzle-orm";
const schema = z.object({ rating: z.number().int().min(1).max(5), comment: z.string().max(2000).optional() });
async function userId() { const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser(); return user?.id; }
export async function GET() { const id = await userId(); if (!id) return NextResponse.json({ canRate: false }); const [latest] = await db.select({ createdAt: userRatings.createdAt }).from(userRatings).where(eq(userRatings.userId, id)).orderBy(desc(userRatings.createdAt)).limit(1); return NextResponse.json({ canRate: !latest || Date.now() - latest.createdAt.getTime() >= 30 * 86_400_000 }); }
export async function POST(request: NextRequest) { const csrf = requireCsrfProtection(request); if (csrf) return csrf; const body = schema.safeParse(await request.json().catch(() => null)); if (!body.success) return NextResponse.json({ error: "Invalid rating" }, { status: 400 }); const id = await userId(); if (!id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); const [latest] = await db.select({ createdAt: userRatings.createdAt }).from(userRatings).where(eq(userRatings.userId, id)).orderBy(desc(userRatings.createdAt)).limit(1); if (latest && Date.now() - latest.createdAt.getTime() < 30 * 86_400_000) return NextResponse.json({ error: "Rating cooldown active" }, { status: 429 }); await db.insert(userRatings).values({ userId: id, ...body.data }); return NextResponse.json({ ok: true }); }

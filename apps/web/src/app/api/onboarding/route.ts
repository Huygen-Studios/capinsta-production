import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { requireCsrfProtection } from "@/auth/csrf";
import { db, userOnboarding } from "@/db";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({ source: z.string().min(1).max(80), sourceOther: z.string().max(200).optional(), useCase: z.string().min(1).max(80), useCaseOther: z.string().max(200).optional(), experienceLevel: z.string().min(1).max(80), mainGoal: z.string().min(1).max(100), mainGoalOther: z.string().max(200).optional() });
async function currentUser() { const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser(); return user; }
export async function GET() { const user = await currentUser(); if (!user) return NextResponse.json({ completed: false }); const [row] = await db.select({ completedAt: userOnboarding.completedAt }).from(userOnboarding).where(eq(userOnboarding.userId, user.id)).limit(1); return NextResponse.json({ completed: Boolean(row?.completedAt) }); }
export async function POST(request: NextRequest) { const csrf = requireCsrfProtection(request); if (csrf) return csrf; const user = await currentUser(); if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 }); const body = schema.safeParse(await request.json().catch(() => null)); if (!body.success) return NextResponse.json({ error: "Invalid onboarding response" }, { status: 400 }); await db.insert(userOnboarding).values({ userId: user.id, ...body.data, completedAt: new Date() }).onConflictDoUpdate({ target: userOnboarding.userId, set: { ...body.data, completedAt: new Date() } }); return NextResponse.json({ completed: true }); }

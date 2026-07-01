import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCsrfProtection } from "@/auth/csrf";
import { getCurrentAdminContext } from "@/admin/auth";
import {
  clearAdminLoginPair,
  recordAdminLoginFailure,
} from "@/admin/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db";
import { adminFreshMfa } from "@/db/schema";
import { profiles } from "@/db/schema";
import { eq } from "drizzle-orm";

const verifySchema = z.object({
  code: z.string().regex(/^\d{6}$/),
  factorId: z.string().min(1),
});

export async function GET() {
  const context = await getCurrentAdminContext();
  if (!context)
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  const supabase = await createClient();
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error)
    return NextResponse.json({ error: "Unable to load MFA." }, { status: 400 });
  const verified = data.totp.find((factor) => factor.status === "verified");
  if (verified)
    return NextResponse.json({ mode: "challenge", factorId: verified.id });
  const { data: enrollment, error: enrollError } =
    await supabase.auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Capinsta Admin",
    });
  if (enrollError)
    return NextResponse.json(
      { error: "Unable to enroll MFA." },
      { status: 400 },
    );
  return NextResponse.json({
    mode: "enroll",
    factorId: enrollment.id,
    qrCode: enrollment.totp.qr_code,
    secret: enrollment.totp.secret,
  });
}

export async function POST(request: Request) {
  const csrf = requireCsrfProtection(request);
  if (csrf) return csrf;

  const context = await getCurrentAdminContext();
  if (!context)
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  const parsed = verifySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid verification code." },
      { status: 400 },
    );
  const supabase = await createClient();
  const { data: challenge, error: challengeError } =
    await supabase.auth.mfa.challenge({ factorId: parsed.data.factorId });
  if (challengeError)
    return NextResponse.json(
      { error: "Verification failed." },
      { status: 400 },
    );
  const { error } = await supabase.auth.mfa.verify({
    factorId: parsed.data.factorId,
    challengeId: challenge.id,
    code: parsed.data.code,
  });
  if (error) {
    await recordAdminLoginFailure({
      email: context.email ?? context.userId,
      failureType: "mfa",
    });
    return NextResponse.json(
      { error: "Verification failed." },
      { status: 401 },
    );
  }
  const refreshed = await getCurrentAdminContext();
  if (refreshed?.sessionId) {
    await db
      .insert(adminFreshMfa)
      .values({
        adminUserId: refreshed.userId,
        sessionId: refreshed.sessionId,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      })
      .onConflictDoUpdate({
        target: [adminFreshMfa.adminUserId, adminFreshMfa.sessionId],
        set: {
          verifiedAt: new Date(),
          expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        },
      });
    await db
      .update(profiles)
      .set({ adminMfaResetRequired: false, updatedAt: new Date() })
      .where(eq(profiles.userId, refreshed.userId));
  }
  if (context.email) await clearAdminLoginPair(context.email);
  return NextResponse.json({ next: "/admincapinsta11/overview" });
}

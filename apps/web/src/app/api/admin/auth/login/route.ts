import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCsrfProtection } from "@/auth/csrf";
import { GENERIC_LOGIN_ERROR } from "@/auth/messages";
import { PASSWORD_POLICY } from "@/auth/password-policy";
import { getCurrentAdminContext } from "@/admin/auth";
import {
  checkAdminLoginLimit,
  clearAdminLoginPair,
  recordAdminLoginFailure,
} from "@/admin/rate-limit";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(PASSWORD_POLICY.maxLength),
});

export async function POST(request: Request) {
  const csrf = requireCsrfProtection(request);
  if (csrf) return csrf;

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    const oversizedPassword = parsed.error.issues.some(
      (issue) => issue.path.join(".") === "password" && issue.code === "too_big",
    );
    return NextResponse.json(
      { error: oversizedPassword ? PASSWORD_POLICY.tooLongMessage : GENERIC_LOGIN_ERROR },
      { status: 400 },
    );
  }
  const limit = await checkAdminLoginLimit(parsed.data.email);
  if (limit.blocked) {
    return NextResponse.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    await recordAdminLoginFailure({
      email: parsed.data.email,
      failureType: "primary_auth",
    });
    return NextResponse.json({ error: GENERIC_LOGIN_ERROR }, { status: 401 });
  }
  const context = await getCurrentAdminContext();
  if (!context) {
    await supabase.auth.signOut();
    await recordAdminLoginFailure({
      email: parsed.data.email,
      failureType: "membership",
    });
    return NextResponse.json({ error: GENERIC_LOGIN_ERROR }, { status: 401 });
  }
  if (context.aal === "aal2") {
    await clearAdminLoginPair(parsed.data.email);
  }
  return NextResponse.json({
    next:
      context.aal === "aal2"
        ? "/admincapinsta11/overview"
        : "/admincapinsta11/mfa",
  });
}

import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireCsrfProtection } from "@/auth/csrf";
import { checkRateLimit } from "@/auth/rate-limit";
import { submitFeedback, MAX_MESSAGE_LENGTH } from "@/feedback";
import { createClient } from "@/lib/supabase/server";

const submitSchema = z.object({
	message: z
		.string()
		.min(1, "Message is required")
		.max(MAX_MESSAGE_LENGTH, "Message too long"),
});

export async function POST(request: NextRequest) {
	const csrf = requireCsrfProtection(request);
	if (csrf) return csrf;

	const { limited } = await checkRateLimit({ request });
	if (limited) {
		return NextResponse.json({ error: "Too many requests" }, { status: 429 });
	}

	const body = await request.json().catch(() => null);
	const result = submitSchema.safeParse(body);

	if (!result.success) {
		return NextResponse.json(
			{ error: "Invalid input", details: result.error.flatten().fieldErrors },
			{ status: 400 },
		);
	}

	const supabase = await createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();

	try {
		const entry = await submitFeedback({
			...result.data,
			userId: user?.id ?? null,
			email: user?.email ?? null,
			page: request.headers.get("referer")?.slice(0, 1000) ?? null,
			browser: request.headers.get("user-agent")?.slice(0, 1000) ?? null,
			appVersion: process.env.COMMIT_SHA?.slice(0, 64) ?? null,
		});
		return NextResponse.json({ entry }, { status: 201 });
	} catch (error) {
		console.error("feedback_submission_failed", {
			error:
				error instanceof Error
					? { name: error.name, message: error.message }
					: { name: "UnknownError", message: "Unknown feedback failure" },
		});
		return NextResponse.json(
			{ error: "Feedback could not be saved. Please try again." },
			{ status: 503 },
		);
	}
}

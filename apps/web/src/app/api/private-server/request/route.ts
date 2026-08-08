import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { requireCsrfProtection } from "@/auth/csrf";
import { checkRateLimit } from "@/auth/rate-limit";
import { db } from "@/db";
import { privateServerRequests } from "@/db/schema";
import { webEnv } from "@/env/web";
import { createClient } from "@/lib/supabase/server";
import { privateServerRequestSchema } from "@/private-server/request";
import { recordProductEvent } from "@/product-events/ledger";

function firstForwardedIp({ request }: { request: NextRequest }) {
	return (
		request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
		request.headers.get("x-real-ip")?.trim() ||
		null
	);
}

function hashIp({ ip }: { ip: string | null }) {
	if (!ip) return null;
	return createHash("sha256")
		.update(`${webEnv.ADMIN_SECURITY_PEPPER}:${ip}`)
		.digest("hex");
}

export async function POST(request: NextRequest) {
	const csrf = requireCsrfProtection(request);
	if (csrf) return csrf;

	const { limited } = await checkRateLimit({ request });
	if (limited) {
		return NextResponse.json(
			{ error: "We could not submit your request. Please try again later." },
			{ status: 429 },
		);
	}

	const body = await request.json().catch(() => null);
	const result = privateServerRequestSchema.safeParse(body);
	if (!result.success) {
		return NextResponse.json(
			{
				error: "We could not submit your request. Please check the form and try again.",
				details: result.error.flatten().fieldErrors,
			},
			{ status: 400 },
		);
	}

	const supabase = await createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();

	try {
		const [entry] = await db
			.insert(privateServerRequests)
			.values({
				status: "new",
				fullName: result.data.fullName,
				email: result.data.email,
				companyName: result.data.companyName,
				phone: result.data.phone,
				website: result.data.website,
				teamSize: result.data.teamSize,
				monthlyWorkload: result.data.monthlyWorkload,
				primaryUseCase: result.data.primaryUseCase,
				currentPlanOrUsage: result.data.currentPlanOrUsage,
				preferredContactMethod: result.data.preferredContactMethod,
				preferredContactTime: result.data.preferredContactTime,
				technicalRequirements: result.data.technicalRequirements,
				message: result.data.message,
				consentToContact: result.data.consentToContact,
				submittedFromUrl: request.headers.get("referer")?.slice(0, 1000) ?? null,
				userId: user?.id ?? null,
				ipHash: hashIp({ ip: firstForwardedIp({ request }) }),
				userAgent: request.headers.get("user-agent")?.slice(0, 1000) ?? null,
			})
			.returning({ id: privateServerRequests.id });

		void recordProductEvent({
			eventName: "private_server_request_submitted",
			eventKey: `private_server_request_submitted:${entry.id}`,
			userId: user?.id ?? null,
			metadata: {
				requestId: entry.id,
				hasAuthenticatedUser: Boolean(user?.id),
				source: "private_server_requests",
			},
		}).catch((error) => {
			console.error("product_event_record_failed", {
				eventName: "private_server_request_submitted",
				errorName: error instanceof Error ? error.name : "UnknownError",
			});
		});

		return NextResponse.json(
			{
				status: "received",
				requestId: entry.id,
				message:
					"Thanks - your Private Server request has been received. Our team will review your requirements and contact you shortly.",
			},
			{ status: 201 },
		);
	} catch (error) {
		console.error("private_server_request_failed", {
			errorName: error instanceof Error ? error.name : "UnknownError",
			errorMessage: error instanceof Error ? error.message.slice(0, 160) : "unknown",
		});
		return NextResponse.json(
			{ error: "We could not submit your request. Please try again later." },
			{ status: 503 },
		);
	}
}

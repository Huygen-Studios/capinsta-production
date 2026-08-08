import { NextResponse } from "next/server";
import { readyPayload } from "@/health/status";

export const dynamic = "force-dynamic";

export async function GET() {
	const payload = await readyPayload();
	return NextResponse.json(payload, {
		status: payload.ready ? 200 : 503,
		headers: { "Cache-Control": "no-store, max-age=0" },
	});
}

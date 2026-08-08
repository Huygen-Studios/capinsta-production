import { NextResponse } from "next/server";
import { livePayload } from "@/health/status";

export const dynamic = "force-dynamic";

export async function GET() {
	return NextResponse.json(livePayload(), {
		headers: { "Cache-Control": "no-store, max-age=0" },
	});
}

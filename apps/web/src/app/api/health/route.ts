import { NextResponse } from "next/server";
import { livePayload } from "@/health/status";

export async function GET() {
	return NextResponse.json({
		...livePayload(),
		compatibility: "Existing /api/health behaves as a liveness summary.",
	});
}

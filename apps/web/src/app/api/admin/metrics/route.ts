import { NextResponse, type NextRequest } from "next/server";
import { requireAdminPermission } from "@/admin/auth";
import {
	getAdminMetrics,
	normalizeAdminMetricsRangePreset,
} from "@/admin/metrics";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET(request: NextRequest) {
	try {
		await requireAdminPermission("system.read");
	} catch {
		return NextResponse.json(
			{ error: "Forbidden", code: "admin_required" },
			{ status: 403 },
		);
	}

	const preset = normalizeAdminMetricsRangePreset({
		value: request.nextUrl.searchParams.get("range"),
	});
	const payload = await getAdminMetrics({ preset });
	return NextResponse.json(payload, {
		headers: {
			"Cache-Control": "no-store, max-age=0",
		},
	});
}

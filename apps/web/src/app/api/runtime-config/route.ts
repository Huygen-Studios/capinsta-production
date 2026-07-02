import { NextResponse } from "next/server";
import { getRuntimeConfiguration } from "@/admin/runtime-config";
import { isUiTestAuthBypassEnabled } from "@/auth/routes";

const PUBLIC_FLAGS = [
	"sample_import_enabled",
	"advertisements_enabled",
] as const;

export async function GET() {
	if (isUiTestAuthBypassEnabled()) {
		return NextResponse.json(
			{
				flags: Object.fromEntries(PUBLIC_FLAGS.map((key) => [key, false])),
			},
			{
				headers: {
					"Cache-Control": "private, max-age=0, must-revalidate",
				},
			},
		);
	}
	const configuration = await getRuntimeConfiguration();
	return NextResponse.json(
		{
			flags: Object.fromEntries(
				PUBLIC_FLAGS.map((key) => [
					key,
					configuration.flags[key]?.enabled ?? false,
				]),
			),
		},
		{
			headers: {
				"Cache-Control": "private, max-age=0, must-revalidate",
			},
		},
	);
}

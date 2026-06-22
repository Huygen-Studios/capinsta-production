import { NextResponse } from "next/server";
import { getRuntimeConfiguration } from "@/admin/runtime-config";

const PUBLIC_FLAGS = [
	"sample_import_enabled",
	"advertisements_enabled",
] as const;

export async function GET() {
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

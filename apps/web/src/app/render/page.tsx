import type { Metadata } from "next";
import { RenderPageClient } from "./render-client";
import { firstSearchParam, validateRenderToken } from "./render-token";

export const metadata: Metadata = {
	title: "Capinsta Renderer",
	robots: { index: false, follow: false, nocache: true, noarchive: true },
};

type RenderPageProps = {
	searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function RenderAuthError({ reason }: { reason: string }) {
	return (
		<main
			id="capinsta-render-auth-error"
			data-render-auth-error="true"
			style={{
				minHeight: "100vh",
				background: "#050505",
				color: "#f8fafc",
				fontFamily: "system-ui, sans-serif",
				display: "grid",
				placeItems: "center",
				padding: 24,
			}}
		>
			<div style={{ maxWidth: 520 }}>
				<h1 style={{ fontSize: 20, marginBottom: 8 }}>
					Renderer authorization failed
				</h1>
				<p style={{ color: "#94a3b8", lineHeight: 1.5 }}>{reason}</p>
			</div>
		</main>
	);
}

export default async function RenderPage({ searchParams }: RenderPageProps) {
	const params = (await searchParams) ?? {};
	const validation = validateRenderToken({
		exportJobId: firstSearchParam(params.export_job_id),
		token: firstSearchParam(params.render_token),
		secret: process.env.CAPINSTA_RENDER_TOKEN_SECRET,
	});

	if (!validation.ok) return <RenderAuthError reason={validation.reason} />;

	return <RenderPageClient />;
}

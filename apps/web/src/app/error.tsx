"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	useEffect(() => {
		console.error("Application route error", error);
	}, [error]);

	return (
		<main className="flex min-h-screen items-center justify-center bg-background bg-grid-paper p-4 text-foreground">
			<section className="max-w-lg rounded-sm border-2 border-border bg-card p-8 text-center shadow-[6px_6px_0_var(--shadow-strong)]">
				<p className="font-display text-sm uppercase tracking-[.18em] text-primary">Something went wrong</p>
				<h1 className="font-display mt-4 text-4xl font-black">Capinsta hit an unexpected error.</h1>
				<p className="mt-4 text-muted-foreground">
					Your project data has not been intentionally changed. Try this screen again,
					or return to your projects.
				</p>
				{error.digest ? (
					<p className="mt-4 border-2 border-border bg-background p-2 text-xs text-muted-foreground">
						Correlation ID: {error.digest}
					</p>
				) : null}
				<div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
					<Button variant="brutal" onClick={reset}>Try again</Button>
					<Button asChild variant="outline"><Link href="/projects">Back to projects</Link></Button>
				</div>
			</section>
		</main>
	);
}

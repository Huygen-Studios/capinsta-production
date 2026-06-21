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
		<main className="marketing-theme flex min-h-screen items-center justify-center bg-background p-4 text-foreground">
			<section className="cap-brutal-card max-w-lg p-8 text-center">
				<p className="font-black uppercase tracking-[.18em] text-primary">Something went wrong</p>
				<h1 className="mt-4 text-4xl font-black">Capinsta hit an unexpected error.</h1>
				<p className="mt-4 text-muted-foreground">
					Your project data has not been intentionally changed. Try this screen again,
					or return to your projects.
				</p>
				<div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
					<Button variant="lime" onClick={reset}>Try again</Button>
					<Button asChild variant="outline"><Link href="/projects">Back to projects</Link></Button>
				</div>
			</section>
		</main>
	);
}

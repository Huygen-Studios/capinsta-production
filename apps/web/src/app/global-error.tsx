"use client";

export default function GlobalError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	return (
		<html lang="en">
			<body className="bg-background text-foreground">
				<main className="flex min-h-screen items-center justify-center p-6 text-center">
					<div className="rounded-sm border-2 border-border bg-card p-8 shadow-[6px_6px_0_var(--shadow-strong)]">
						<p className="text-xs font-black uppercase tracking-[.18em] text-primary">Something went wrong</p>
						<h1 className="mt-4 text-3xl font-black">Capinsta could not load.</h1>
						<p className="mt-3 text-muted-foreground">Please retry the application.</p>
						{error.digest ? (
							<p className="mt-4 border-2 border-primary bg-background p-2 text-xs text-muted-foreground">
								Correlation ID: {error.digest}
							</p>
						) : null}
						<button
							type="button"
							onClick={reset}
							className="mt-6 rounded-sm border-2 border-[var(--neo-black)] bg-primary px-5 py-3 font-black text-primary-foreground shadow-[4px_4px_0_var(--shadow-strong)] transition-[transform,box-shadow] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
						>
							Try again
						</button>
					</div>
				</main>
			</body>
		</html>
	);
}

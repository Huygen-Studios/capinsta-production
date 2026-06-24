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
					<div className="border-2 border-foreground bg-card p-8 shadow-[8px_8px_0_var(--cap-shadow-color)]">
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
							className="mt-6 border-2 border-foreground bg-primary px-5 py-3 font-bold text-primary-foreground shadow-[4px_4px_0_var(--cap-shadow-color)] transition-[transform,box-shadow] hover:-translate-x-0.5 hover:-translate-y-0.5 active:translate-x-0.5 active:translate-y-0.5 active:shadow-[1px_1px_0_var(--cap-shadow-color)]"
						>
							Try again
						</button>
					</div>
				</main>
			</body>
		</html>
	);
}

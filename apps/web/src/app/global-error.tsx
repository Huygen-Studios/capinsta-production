"use client";

export default function GlobalError({
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	return (
		<html lang="en">
			<body className="bg-[#0d0818] text-white">
				<main className="flex min-h-screen items-center justify-center p-6 text-center">
					<div>
						<h1 className="text-3xl font-bold">Capinsta could not load.</h1>
						<p className="mt-3 text-white/70">Please retry the application.</p>
						<button
							type="button"
							onClick={reset}
							className="mt-6 rounded-lg border-2 border-white bg-[#dfff00] px-5 py-3 font-bold text-[#111]"
						>
							Try again
						</button>
					</div>
				</main>
			</body>
		</html>
	);
}

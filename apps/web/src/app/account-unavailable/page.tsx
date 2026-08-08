import { LogoStatic } from "@/components/logo";
import { AccessSignOutButton } from "@/components/access/access-sign-out-button";

export const dynamic = "force-dynamic";

export default function Page() {
	return (
		<main className="grid min-h-svh place-items-center bg-background px-6 text-foreground">
			<section className="w-full max-w-lg rounded-lg border-2 bg-card p-6 shadow-[4px_4px_0_var(--foreground)]">
				<LogoStatic variant="wordmark" height={36} alt="Capinsta" priority />
				<h1 className="mt-8 font-display text-3xl font-black">
					Account unavailable.
				</h1>
				<p className="mt-3 text-muted-foreground">
					This account cannot access Capinsta right now.
				</p>
				<div className="mt-6">
					<AccessSignOutButton />
				</div>
			</section>
		</main>
	);
}

import Link from "next/link";
import { LogoStatic } from "@/components/logo";
import { Button } from "@/components/ui/button";
import type { AccessContext, SitePolicy } from "@/access/server";
import { AccessSignOutButton } from "./access-sign-out-button";

export function ComingSoonPage({ policy }: { policy: SitePolicy }) {
	return (
		<main className="min-h-svh bg-background text-foreground">
			<div className="mx-auto grid min-h-svh max-w-6xl content-center gap-10 px-6 py-10 lg:grid-cols-[1fr_420px] lg:items-center">
				<section className="max-w-2xl">
					<LogoStatic variant="wordmark" height={42} alt="Capinsta" priority />
					<h1 className="mt-10 font-display text-5xl font-black leading-tight sm:text-6xl">
						Make every word land on time.
					</h1>
					<p className="mt-5 max-w-xl text-lg text-muted-foreground">
						{policy.comingSoonMessage}
					</p>
					<div className="mt-8 flex flex-wrap gap-3">
						{policy.allowSignups ? (
							<>
								<Button asChild size="lg" variant="lime">
									<Link href="/sign-up">Create account</Link>
								</Button>
								<Button asChild size="lg" variant="outline">
									<Link href="/sign-up">Continue with Google</Link>
								</Button>
							</>
						) : (
							<p className="rounded-md border px-4 py-3 text-sm font-semibold">
								New registrations are temporarily paused.
							</p>
						)}
						<Button asChild size="lg" variant="ghost">
							<Link href="/sign-in">Sign in</Link>
						</Button>
					</div>
					<div className="mt-8 flex gap-5 text-sm text-muted-foreground">
						<Link href="/privacy" className="hover:text-foreground">
							Privacy
						</Link>
						<Link href="/terms" className="hover:text-foreground">
							Terms
						</Link>
					</div>
				</section>
				<aside className="rounded-lg border-2 bg-card p-5 shadow-[4px_4px_0_var(--foreground)]">
					<div className="aspect-[9/16] overflow-hidden rounded-md bg-foreground p-5 text-background">
						<div className="flex h-full flex-col justify-end gap-4">
							{["Cut the pause.", "Catch the beat.", "Land the line."].map(
								(line, index) => (
									<div
										key={line}
										className="rounded-md bg-background px-4 py-3 font-display text-xl font-black text-foreground"
										style={{ opacity: 1 - index * 0.18 }}
									>
										{line}
									</div>
								),
							)}
						</div>
					</div>
				</aside>
			</div>
		</main>
	);
}

export function MaintenancePage({ policy }: { policy: SitePolicy }) {
	return (
		<main className="grid min-h-svh place-items-center bg-background px-6 text-foreground">
			<section className="max-w-xl text-center">
				<LogoStatic variant="wordmark" height={40} alt="Capinsta" priority />
				<h1 className="mt-8 font-display text-4xl font-black">
					Capinsta is temporarily unavailable.
				</h1>
				<p className="mt-4 text-muted-foreground">
					{policy.maintenanceMessage}
				</p>
				<div className="mt-8 flex justify-center gap-3">
					<Button asChild variant="outline">
						<Link href="/sign-in">Sign in</Link>
					</Button>
				</div>
			</section>
		</main>
	);
}

export function EarlyAccessPage({ context }: { context: AccessContext }) {
	const verified = context.emailConfirmedAt ? "Verified" : "Not verified yet";
	return (
		<main className="grid min-h-svh place-items-center bg-background px-6 text-foreground">
			<section className="w-full max-w-xl rounded-lg border-2 bg-card p-6 shadow-[4px_4px_0_var(--foreground)]">
				<LogoStatic variant="wordmark" height={36} alt="Capinsta" priority />
				<h1 className="mt-8 font-display text-3xl font-black">
					Your Capinsta account is ready.
				</h1>
				<p className="mt-3 text-muted-foreground">
					We&apos;re currently inviting users in small groups. You&apos;ll receive access
					when your account is approved.
				</p>
				<dl className="mt-6 grid gap-3 rounded-md border bg-background p-4 text-sm">
					<div className="flex justify-between gap-4">
						<dt className="text-muted-foreground">Email</dt>
						<dd className="font-mono">{context.email ?? "Unavailable"}</dd>
					</div>
					<div className="flex justify-between gap-4">
						<dt className="text-muted-foreground">Verification</dt>
						<dd>{verified}</dd>
					</div>
					<div className="flex justify-between gap-4">
						<dt className="text-muted-foreground">Access status</dt>
						<dd>{context.productAccessExpired ? "expired" : context.productAccessStatus}</dd>
					</div>
				</dl>
				<div className="mt-6">
					<AccessSignOutButton />
				</div>
			</section>
		</main>
	);
}

export function AccessRevokedPage({ context }: { context: AccessContext }) {
	return (
		<main className="grid min-h-svh place-items-center bg-background px-6 text-foreground">
			<section className="w-full max-w-lg rounded-lg border-2 bg-card p-6 shadow-[4px_4px_0_var(--foreground)]">
				<LogoStatic variant="wordmark" height={36} alt="Capinsta" priority />
				<h1 className="mt-8 font-display text-3xl font-black">
					Access is unavailable.
				</h1>
				<p className="mt-3 text-muted-foreground">
					This account cannot access Capinsta product pages right now.
				</p>
				<p className="mt-5 rounded-md border bg-background p-3 font-mono text-sm">
					{context.email ?? context.userId}
				</p>
				<div className="mt-6">
					<AccessSignOutButton />
				</div>
			</section>
		</main>
	);
}

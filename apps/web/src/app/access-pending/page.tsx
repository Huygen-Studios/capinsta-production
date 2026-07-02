import Link from "next/link";
import { requireAuthenticatedUser } from "@/access/server";
import { LogoStatic } from "@/components/logo";
import { Button } from "@/components/ui/button";

export const dynamic = "force-dynamic";

export default async function AccessPendingPage() {
	const context = await requireAuthenticatedUser("/access-pending");
	return (
		<main className="grid min-h-svh place-items-center bg-background px-6 text-foreground">
			<section className="w-full max-w-xl rounded-sm border-2 bg-card p-6 shadow-[5px_5px_0_var(--secondary)]">
				<LogoStatic variant="wordmark" height={36} alt="Capinsta" priority />
				<p className="mt-8 font-mono text-sm font-black text-primary">ACCESS PENDING</p>
				<h1 className="mt-3 font-display text-3xl font-black">
					Editor access has not been granted yet.
				</h1>
				<p className="mt-3 text-muted-foreground">
					Your account is active, but editor access has not been granted yet.
					An administrator can approve access from the Capinsta admin panel.
				</p>
				<dl className="mt-6 grid gap-3 rounded-sm border bg-background p-4 text-sm">
					<div className="flex justify-between gap-4">
						<dt className="text-muted-foreground">Account</dt>
						<dd className="truncate font-mono">{context.email ?? context.userId}</dd>
					</div>
					<div className="flex justify-between gap-4">
						<dt className="text-muted-foreground">Status</dt>
						<dd className="font-semibold">Waiting for editor access</dd>
					</div>
				</dl>
				<div className="mt-6 flex flex-wrap gap-3">
					<Button asChild variant="lime">
						<Link href="/">Back to home</Link>
					</Button>
					<Button asChild variant="outline">
						<Link href="/account">Account settings</Link>
					</Button>
				</div>
			</section>
		</main>
	);
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { getBillingOverview } from "@/billing/entitlements";
import { createClient } from "@/lib/supabase/server";

function statusLabel(status: string) {
	return status.replace(/_/g, " ");
}

export default async function AccountPage() {
	const supabase = await createClient();
	const {
		data: { user },
	} = await supabase.auth.getUser();
	if (!user) redirect("/sign-in?redirect=%2Faccount");
	const billing = await getBillingOverview(user.id);
	const hasPrivateServer = billing.entitlements.some(
		(entitlement) =>
			entitlement.entitlementKey === "private_server" &&
			entitlement.status === "active",
	);
	const activeWorker = billing.workerJobs.find((job) => job.state === "active");
	const pendingWorker = billing.workerJobs.find((job) =>
		["pending", "provisioning"].includes(job.state),
	);

	return (
		<main className="marketing-theme min-h-screen bg-background bg-grid-paper px-4 py-10 text-foreground">
			<div className="mx-auto max-w-4xl">
				<Link href="/projects" className="text-sm font-semibold text-primary hover:underline">
					Back to projects
				</Link>
				<h1 className="mt-6 text-4xl font-black">Account</h1>
				<section className="cap-brutal-card mt-8 bg-card p-6">
					<h2 className="text-2xl font-black">Billing</h2>
					<div className="mt-5 grid gap-4 sm:grid-cols-2">
						<div>
							<p className="text-sm text-muted-foreground">Current plan</p>
							<p className="mt-1 text-xl font-black">
								{hasPrivateServer ? "Private Server" : "Free"}
							</p>
						</div>
						<div>
							<p className="text-sm text-muted-foreground">Worker status</p>
							<p className="mt-1 text-xl font-black">
								{activeWorker
									? "Private Server Active"
									: pendingWorker
										? `Provisioning: ${statusLabel(pendingWorker.state)}`
										: "Shared servers"}
							</p>
						</div>
					</div>
					<div className="mt-6 space-y-3">
						<p className="text-sm text-muted-foreground">
							Private Server access is reviewed and enabled by the Capinsta team after a
							request is approved. Online subscription checkout is not available.
						</p>
					</div>
					<Link
						href="/pricing"
						className="mt-6 inline-flex h-11 items-center justify-center rounded-sm border-2 border-[var(--neo-black)] bg-primary px-4 text-sm font-black text-primary-foreground shadow-[4px_4px_0_var(--shadow-strong)]"
					>
						Manage plan
					</Link>
				</section>
			</div>
		</main>
	);
}

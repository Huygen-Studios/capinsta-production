import { count, eq, sql } from "drizzle-orm";
import { requireAdminPermission } from "@/admin/auth";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import {
	AdminSignupPolicyForm,
	AdminSiteModeForm,
} from "@/components/admin/admin-access-controls";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { db } from "@/db";
import { appRoleMembers, appRoles, profiles, siteAccessPolicy } from "@/db/schema";

export const dynamic = "force-dynamic";

export default async function Page() {
	await requireAdminPermission("access.read");
	const [policy] = await db
		.select()
		.from(siteAccessPolicy)
		.where(eq(siteAccessPolicy.id, "global"))
		.limit(1);
	const accessCounts = await db
		.select({
			status: profiles.productAccessStatus,
			total: count(),
		})
		.from(profiles)
		.groupBy(profiles.productAccessStatus);
	const developerCount = await db
		.select({ total: count() })
		.from(appRoleMembers)
		.innerJoin(appRoles, eq(appRoles.id, appRoleMembers.roleId))
		.where(
			sql`${appRoles.key} = 'developer' and ${appRoleMembers.active} = true and (${appRoleMembers.expiresAt} is null or ${appRoleMembers.expiresAt} > now())`,
		);

	return (
		<>
			<AdminPageHeader
				title="Access control"
				description="Global site access, private-beta approvals, and product roles."
			/>
			<div className="grid gap-4 xl:grid-cols-3">
				<Card className="border-2 xl:col-span-3">
					<CardHeader>
						<CardTitle>Site status</CardTitle>
					</CardHeader>
					<CardContent className="grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
						<Field label="Current mode" value={policy?.mode ?? "public"} />
						<Field label="Signup availability" value={policy?.allowSignups ? "Enabled" : "Paused"} />
						<Field label="Policy version" value={String(policy?.version ?? 1)} />
						<Field label="Last updated" value={policy?.updatedAt?.toISOString() ?? "Not recorded"} />
					</CardContent>
				</Card>
				<Card className="border-2 xl:col-span-3">
					<CardHeader>
						<CardTitle className="flex items-center justify-between">
							Global signup policy
							<Badge variant={policy?.allowSignups ? "outline" : "destructive"}>
								{policy?.allowSignups ? "Enabled" : "Paused"}
							</Badge>
						</CardTitle>
					</CardHeader>
					<CardContent>
						<AdminSignupPolicyForm allowSignups={policy?.allowSignups ?? true} />
					</CardContent>
				</Card>
				{[
					{
						mode: "coming_soon" as const,
						title: "Coming Soon",
						text: "The landing page remains public. Only administrators and explicitly approved accounts can access product features.",
						confirmation:
							"Changing to Coming Soon keeps product routes protected and leaves the public landing page available.",
					},
					{
						mode: "maintenance" as const,
						title: "Maintenance",
						text: "Normal product access is temporarily blocked. Administrators and approved maintenance operators may continue operational work.",
						confirmation:
							"Changing to Maintenance will block normal product use until bypassed or restored.",
					},
					{
						mode: "public" as const,
						title: "Public",
						text: "Authenticated users can access the editor and product features by default. Explicit account bans and restrictions still apply.",
						confirmation:
							"Changing to Public enables default product access for eligible authenticated users; explicit restrictions remain enforced.",
					},
				].map((card) => (
					<Card key={card.mode} className="border-2">
						<CardHeader>
							<CardTitle className="flex items-center justify-between">
								{card.title}
								{policy?.mode === card.mode ? <Badge>Current</Badge> : null}
							</CardTitle>
						</CardHeader>
						<CardContent className="grid gap-4">
							<p className="text-sm text-muted-foreground">{card.text}</p>
							<AdminSiteModeForm
								mode={card.mode}
								confirmation={card.confirmation}
							/>
						</CardContent>
					</Card>
				))}
				<Card className="border-2 xl:col-span-3">
					<CardHeader>
						<CardTitle>Access summary</CardTitle>
					</CardHeader>
					<CardContent className="flex flex-wrap gap-3">
						{accessCounts.map((row) => (
							<Badge key={row.status} variant="outline">
								{row.status}: {row.total}
							</Badge>
						))}
						<Badge variant="outline">
							developers: {developerCount[0]?.total ?? 0}
						</Badge>
					</CardContent>
				</Card>
			</div>
		</>
	);
}

function Field({ label, value }: { label: string; value: string }) {
	return (
		<div className="rounded-md border bg-card p-3">
			<p className="text-xs font-semibold uppercase text-muted-foreground">
				{label}
			</p>
			<p className="mt-1 font-mono">{value}</p>
		</div>
	);
}

import { sql } from "drizzle-orm";
import { requireAdminPermission } from "@/admin/auth";
import { db } from "@/db";
import { AdminPageHeader } from "@/components/admin/admin-page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function InsightsPage() {
	await requireAdminPermission("feedback.read");
	const result = await db.execute(sql`select
		(select count(*)::int from user_onboarding where completed_at is not null) as onboarded,
		(select round(avg(rating)::numeric, 1) from user_ratings) as average_rating,
		(select count(*)::int from user_ratings where rating <= 2 and created_at > now() - interval '30 days') as low_ratings,
		(select count(*)::int from support_cases where status in ('new', 'open') and category = 'export_problem') as export_issues,
		(select count(*)::int from support_cases where status in ('new', 'open') and category = 'feature_request') as feature_requests`);
	const row = result[0] as Record<string, string | number | null> | undefined;
	const cards = [["Onboarding", `${row?.onboarded ?? 0} completed`, "Source, use case, experience and goal distributions are retained per creator."], ["Ratings", `${row?.average_rating ?? "—"} / 5`, `${row?.low_ratings ?? 0} recent 1–2 star reviews`], ["Feedback", `${row?.export_issues ?? 0} open export issues`, `${row?.feature_requests ?? 0} open feature requests`]];
	return <><AdminPageHeader title="Customer insights" description="Onboarding, post-editor satisfaction, and structured product feedback." /><div className="grid gap-4 md:grid-cols-3">{cards.map(([title, value, detail]) => <Card key={title} className="border-2"><CardHeader><CardTitle>{title}</CardTitle></CardHeader><CardContent><p className="text-3xl font-black">{value}</p><p className="mt-2 text-sm text-muted-foreground">{detail}</p></CardContent></Card>)}</div></>;
}

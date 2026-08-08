import { MaintenancePage } from "@/components/access/access-pages";
import { getSiteAccessPolicy } from "@/access/server";

export const dynamic = "force-dynamic";

export default async function Page() {
	const policy = await getSiteAccessPolicy();
	return <MaintenancePage policy={policy} />;
}

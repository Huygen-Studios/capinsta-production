import { EarlyAccessPage } from "@/components/access/access-pages";
import { requireAuthenticatedUser } from "@/access/server";

export const dynamic = "force-dynamic";

export default async function Page() {
	const context = await requireAuthenticatedUser("/early-access");
	return <EarlyAccessPage context={context} />;
}

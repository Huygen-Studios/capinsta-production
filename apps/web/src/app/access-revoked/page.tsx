import { AccessRevokedPage } from "@/components/access/access-pages";
import { requireAuthenticatedUser } from "@/access/server";

export const dynamic = "force-dynamic";

export default async function Page() {
	const context = await requireAuthenticatedUser("/access-revoked");
	return <AccessRevokedPage context={context} />;
}

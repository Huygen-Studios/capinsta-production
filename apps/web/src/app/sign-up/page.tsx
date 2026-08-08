import { isSafeInternalPath } from "@/auth/routes";
import { SignUpForm } from "./sign-up-form";
import { redirectAuthenticatedUser } from "@/auth/require-user";
import { getSiteAccessPolicy } from "@/access/server";

export default async function SignUpPage({
	searchParams,
}: {
	searchParams: Promise<{ redirect?: string }>;
}) {
	const params = await searchParams;
	const redirectPath = isSafeInternalPath(params.redirect);
	await redirectAuthenticatedUser(redirectPath);
	const registrationEnabled = (await getSiteAccessPolicy()).allowSignups;
	return (
		<SignUpForm
			redirectPath={redirectPath}
			registrationEnabled={registrationEnabled}
		/>
	);
}

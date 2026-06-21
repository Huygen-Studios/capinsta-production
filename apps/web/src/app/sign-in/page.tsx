import { SignInForm } from "./sign-in-form";
import { isSafeInternalPath } from "@/auth/routes";
import { redirectAuthenticatedUser } from "@/auth/require-user";

export default async function SignInPage({
	searchParams,
}: {
	searchParams: Promise<{ redirect?: string; error?: string }>;
}) {
	const params = await searchParams;
	const redirectPath = isSafeInternalPath(params.redirect);
	await redirectAuthenticatedUser(redirectPath);
	return (
		<SignInForm
			redirectPath={redirectPath}
			initialError={params.error ?? null}
		/>
	);
}

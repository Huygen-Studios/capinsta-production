import { isSafeInternalPath } from "@/auth/routes";
import { SignUpForm } from "./sign-up-form";
import { redirectAuthenticatedUser } from "@/auth/require-user";

export default async function SignUpPage({
	searchParams,
}: {
	searchParams: Promise<{ redirect?: string }>;
}) {
	const params = await searchParams;
	const redirectPath = isSafeInternalPath(params.redirect);
	await redirectAuthenticatedUser(redirectPath);
	return <SignUpForm redirectPath={redirectPath} />;
}

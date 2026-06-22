import { isSafeInternalPath } from "@/auth/routes";
import { SignUpForm } from "./sign-up-form";
import { redirectAuthenticatedUser } from "@/auth/require-user";
import { isRuntimeFlagEnabled } from "@/admin/runtime-config";

export default async function SignUpPage({
	searchParams,
}: {
	searchParams: Promise<{ redirect?: string }>;
}) {
	const params = await searchParams;
	const redirectPath = isSafeInternalPath(params.redirect);
	await redirectAuthenticatedUser(redirectPath);
	const registrationEnabled = await isRuntimeFlagEnabled({
		key: "registration_enabled",
		fallback: true,
	});
	return (
		<SignUpForm
			redirectPath={redirectPath}
			registrationEnabled={registrationEnabled}
		/>
	);
}

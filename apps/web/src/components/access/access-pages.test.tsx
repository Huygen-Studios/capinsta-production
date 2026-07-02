import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("./access-sign-out-button", () => ({
	AccessSignOutButton: () => <button>Sign out</button>,
}));

const policy = {
	mode: "coming_soon" as const,
	allowSignups: true,
	comingSoonMessage:
		"Create your Capinsta account to join the private beta. We're inviting creators and editors in small groups while we improve timing, editing and export reliability.",
	maintenanceMessage:
		"We're making improvements to the application. Your account and projects remain safe.",
	version: 1,
	updatedBy: null,
	updatedAt: new Date(0),
};

describe("access pages", () => {
	test("does not show waitlist signup CTAs to signed-in users", async () => {
		const { ComingSoonPage } = await import("./access-pages");
		const markup = renderToStaticMarkup(
			<ComingSoonPage
				policy={policy}
				isSignedIn
				signedInEmail="user@example.com"
			/>,
		);
		expect(markup).toContain("Sign out");
		expect(markup).toContain("user@example.com");
		expect(markup).not.toContain("Create account");
		expect(markup).not.toContain("Continue with Google");
		expect(markup).not.toContain(">Sign in<");
	});
});

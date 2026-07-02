import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { DONATION_LEVELS } from "./plans";
import {
	sanitizeDonationText,
	validatePrivateServerSubscriptionEntity,
	validateRazorpayAmount,
} from "./razorpay-validation";

const migration0005 = readFileSync(
	join(import.meta.dir, "../../migrations/0005_rbac_product_access_hardening.sql"),
	"utf8",
);
const migration0006 = readFileSync(
	join(import.meta.dir, "../../migrations/0006_product_access_entitlements.sql"),
	"utf8",
);
const migration = readFileSync(
	join(import.meta.dir, "../../migrations/0007_billing_auth_entitlements.sql"),
	"utf8",
);
const pricingPage = readFileSync(
	join(import.meta.dir, "../app/pricing/page.tsx"),
	"utf8",
);
const donatePage = readFileSync(
	join(import.meta.dir, "../app/donate/donation-form.tsx"),
	"utf8",
);
const checkoutButton = readFileSync(
	join(import.meta.dir, "../components/billing/razorpay-checkout-button.tsx"),
	"utf8",
);
const webhookRoute = readFileSync(
	join(import.meta.dir, "../app/api/billing/webhooks/razorpay/route.ts"),
	"utf8",
);
const webhookProcessor = readFileSync(
	join(import.meta.dir, "../billing/webhook.ts"),
	"utf8",
);
const entitlementModule = readFileSync(
	join(import.meta.dir, "../billing/entitlements.ts"),
	"utf8",
);
const workerProvisioningModule = readFileSync(
	join(import.meta.dir, "../billing/worker-provisioning.ts"),
	"utf8",
);
const accountPage = readFileSync(
	join(import.meta.dir, "../app/account/page.tsx"),
	"utf8",
);

describe("billing and auth schema", () => {
	test("0005, 0006, and 0007 migration order preserves required dependencies", () => {
		expect(migration0005).toContain("CREATE OR REPLACE FUNCTION public.capinsta_has_admin_role");
		expect(migration0005).toContain("SECURITY DEFINER");
		expect(migration0005).toContain("SET search_path = ''");
		expect(migration0006).toContain("CREATE TABLE IF NOT EXISTS \"app_product_entitlements\"");
		expect(migration).toContain("public.capinsta_has_admin_role(NULL)");
	});

	test("auth user trigger creates profile and free entitlement", () => {
		expect(migration).toContain("CREATE TRIGGER \"capinsta_auth_user_profile\"");
		expect(migration).toContain("AFTER INSERT OR UPDATE OF email");
		expect(migration).toContain("INSERT INTO public.profiles");
		expect(migration).toContain("'free', 'active', 'auth_signup'");
		expect(migration).toContain("FROM auth.users u");
		expect(migration).toContain("ON CONFLICT (user_id, entitlement_key) DO UPDATE");
		expect(migration).toContain("CONSTRAINT \"plan_entitlements_pk\" PRIMARY KEY (\"user_id\",\"entitlement_key\")");
		expect(migration).toContain("SET search_path = public, auth");
	});

	test("profile-only users are identified and not treated as auth users", () => {
		expect(migration).toContain("profile_auth_orphans");
		expect(migration).toContain("profile_without_auth_user");
		expect(migration).toContain("REFERENCES auth.users(id)");
	});

	test("RLS protects user-owned billing and worker data", () => {
		for (const table of [
			"plan_entitlements",
			"subscriptions",
			"donations",
			"dedicated_worker_provisioning_jobs",
		]) {
			expect(migration).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
		}
		expect(migration).toContain('"user_id" = (select auth.uid())');
		expect(migration).not.toContain("USING (true)");
		expect(migration).not.toContain("WITH CHECK (true)");
		expect(migration).toContain("profile_auth_orphans_select_admin");
		expect(migration).toContain("plan_entitlements_subscription_fk");
		expect(migration).not.toContain("FOR INSERT TO authenticated");
		expect(migration).not.toContain("FOR UPDATE TO authenticated");
		expect(migration).not.toContain("FOR DELETE TO authenticated");
		expect(migration).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON \"payment_events\" TO service_role");
	});

	test("webhook events are idempotent", () => {
		expect(migration).toContain('"provider_event_id" text NOT NULL');
		expect(migration).toContain("payment_events_provider_event_unique");
		expect(webhookRoute).toContain("request.arrayBuffer()");
		expect(webhookRoute).toContain("verifyRazorpayWebhookSignature");
		expect(webhookRoute.indexOf("verifyRazorpayWebhookSignature")).toBeLessThan(
			webhookRoute.indexOf("JSON.parse(rawBody.toString(\"utf8\"))"),
		);
	});
});

describe("Razorpay validation boundaries", () => {
	test("rejects private-server subscription payloads for the wrong plan", () => {
		expect(
			validatePrivateServerSubscriptionEntity({
				expectedPlanId: "plan_private_server",
				entity: {
					id: "sub_123",
					plan_id: "plan_other",
					notes: { capinsta_user_id: "user_1" },
				},
			}),
		).toEqual({ valid: false, reason: "wrong_plan" });
	});

	test("accepts private-server subscription payloads with server-owned user note", () => {
		expect(
			validatePrivateServerSubscriptionEntity({
				expectedPlanId: "plan_private_server",
				entity: {
					id: "sub_123",
					plan_id: "plan_private_server",
					notes: { capinsta_user_id: "user_1" },
				},
			}),
		).toEqual({ valid: true, reason: "ok" });
	});

	test("validates Razorpay amount and currency before marking paid state", () => {
		expect(
			validateRazorpayAmount({
				amount: 800000,
				currency: "INR",
				expectedAmountPaise: 800000,
			}),
		).toEqual({ valid: true, reason: "ok" });
		expect(
			validateRazorpayAmount({
				amount: 100,
				currency: "INR",
				expectedAmountPaise: 800000,
			}),
		).toEqual({ valid: false, reason: "wrong_amount" });
		expect(
			validateRazorpayAmount({
				amount: 800000,
				currency: "USD",
				expectedAmountPaise: 800000,
			}),
		).toEqual({ valid: false, reason: "wrong_currency" });
	});

	test("webhook processor guards subscription lifecycle and donation isolation", () => {
		expect(webhookProcessor).toContain("razorpay_subscription_user_mismatch");
		expect(webhookProcessor).toContain("isTerminalStatus(existingSubscription.status) && active");
		expect(webhookProcessor).toContain("validateRazorpayAmount");
		expect(webhookProcessor).toContain("processFailedPaymentEvent");
		expect(webhookProcessor).not.toContain("console.log(payload");
		expect(webhookProcessor).not.toContain("RAZORPAY_KEY_SECRET");
	});

	test("sanitizes donation display text before storage", () => {
		expect(
			sanitizeDonationText({ value: "  hi\u0000<script>  ", maxLength: 20 }),
		).toBe("hi <script>");
		expect(sanitizeDonationText({ value: "x".repeat(50), maxLength: 10 })).toBe(
			"xxxxxxxxxx",
		);
		expect(sanitizeDonationText({ value: " \n\t ", maxLength: 10 })).toBeNull();
	});
});

describe("dedicated worker truthfulness", () => {
	test("manual adapter never reports active worker allocation", () => {
		expect(workerProvisioningModule).toContain("awaiting_manual_infrastructure");
		expect(workerProvisioningModule).toContain("state: \"pending\"");
		expect(workerProvisioningModule).not.toContain("state: \"active\"");
		expect(workerProvisioningModule).toContain("external_adapter_not_configured");
	});

	test("routing requires active entitlement and active worker assignment", () => {
		expect(entitlementModule).toContain("entitlementKey: \"private_worker\"");
		expect(entitlementModule).toContain("eq(dedicatedWorkerProvisioningJobs.state, \"active\")");
		expect(accountPage).toContain("Worker status");
		expect(accountPage).toContain("Private Server Active");
		expect(accountPage).toContain("job.state === \"active\"");
	});
});

describe("pricing and donation surfaces", () => {
	test("pricing page renders exactly two pricing cards", () => {
		const cardCount = (pricingPage.match(/<article className=\{cardClass\}/g) ?? []).length;
		expect(cardCount).toBe(2);
		expect(pricingPage).toContain("Free");
		expect(pricingPage).toContain("Private Server");
		expect(pricingPage).not.toContain("Enterprise");
	});

	test("donation page renders all donation levels", () => {
		expect(DONATION_LEVELS).toHaveLength(9);
		for (const level of DONATION_LEVELS) {
			expect(donatePage).toContain("DONATION_LEVELS.map");
			expect(level.amount).toBeGreaterThanOrEqual(100);
		}
	});

	test("client-side checkout never grants paid features", () => {
		expect(checkoutButton).not.toContain("planEntitlements");
		expect(checkoutButton).not.toContain("private_server', 'active");
		expect(checkoutButton).toContain("Verification pending");
		expect(checkoutButton).toContain("webhook confirmation");
	});

	test("HMAC SHA256 signature verification is raw-byte sensitive", () => {
		const body = Buffer.from("{\"event\":\"payment.captured\",\"payload\":{}}", "utf8");
		const semanticallySameBody = Buffer.from(
			"{\"payload\":{},\"event\":\"payment.captured\"}",
			"utf8",
		);
		const secret = "test-secret";
		const signature = createHmac("sha256", secret).update(body).digest("hex");
		const changedSignature = createHmac("sha256", secret)
			.update(semanticallySameBody)
			.digest("hex");
		expect(signature).toHaveLength(64);
		expect(signature).not.toBe(changedSignature);
	});
});

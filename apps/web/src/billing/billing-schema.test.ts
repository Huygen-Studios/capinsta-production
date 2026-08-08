import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { DONATION_TIERS, PRIVATE_SERVER_PRODUCT } from "./plans";
import { sanitizeDonationText, validateRazorpayAmount } from "./razorpay-validation";
import {
	privateServerRequestSchema,
	PRIVATE_SERVER_PRICE_LABEL,
} from "@/private-server/request";

const migration0007 = readFileSync(
	join(import.meta.dir, "../../migrations/0007_billing_auth_entitlements.sql"),
	"utf8",
);
const migration0009 = readFileSync(
	join(import.meta.dir, "../../migrations/0009_private_server_requests.sql"),
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
const requestForm = readFileSync(
	join(import.meta.dir, "../components/billing/private-server-request-form.tsx"),
	"utf8",
);
const requestRoute = readFileSync(
	join(import.meta.dir, "../app/api/private-server/request/route.ts"),
	"utf8",
);
const webhookRoute = readFileSync(
	join(import.meta.dir, "../app/api/billing/webhooks/razorpay/route.ts"),
	"utf8",
);
const donationVerifyRoute = readFileSync(
	join(import.meta.dir, "../app/api/payments/donations/verify/route.ts"),
	"utf8",
);
const razorpayModule = readFileSync(
	join(import.meta.dir, "../billing/razorpay.ts"),
	"utf8",
);
const webhookProcessor = readFileSync(
	join(import.meta.dir, "../billing/webhook.ts"),
	"utf8",
);

describe("billing and request schema", () => {
	test("billing migration keeps historical tables protected", () => {
		for (const table of [
			"plan_entitlements",
			"subscriptions",
			"donations",
			"dedicated_worker_provisioning_jobs",
		]) {
			expect(migration0007).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
		}
		expect(migration0007).toContain('"user_id" = (select auth.uid())');
		expect(migration0007).not.toContain("USING (true)");
		expect(migration0007).not.toContain("WITH CHECK (true)");
	});

	test("private server request migration is server-write and admin/service readable only", () => {
		expect(migration0009).toContain('CREATE TABLE IF NOT EXISTS "private_server_requests"');
		expect(migration0009).toContain("REFERENCES auth.users(id) ON DELETE SET NULL");
		expect(migration0009).toContain("private_server_requests_status_check");
		expect(migration0009).toContain("private_server_requests_consent_check");
		expect(migration0009).toContain('ALTER TABLE "private_server_requests" ENABLE ROW LEVEL SECURITY');
		expect(migration0009).toContain('REVOKE ALL ON "private_server_requests" FROM anon');
		expect(migration0009).toContain('REVOKE ALL ON "private_server_requests" FROM authenticated');
		expect(migration0009).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON "private_server_requests" TO service_role');
		expect(migration0009).toContain("public.capinsta_has_admin_role(NULL)");
		expect(migration0009).not.toContain("FOR INSERT TO anon");
		expect(migration0009).not.toContain("FOR INSERT TO authenticated");
	});

	test("webhook events are idempotent and raw-body verified", () => {
		expect(migration0007).toContain('"provider_event_id" text NOT NULL');
		expect(migration0007).toContain("payment_events_provider_event_unique");
		expect(webhookRoute).toContain("request.arrayBuffer()");
		expect(webhookRoute).toContain("verifyRazorpayWebhookSignature");
		expect(webhookRoute).toContain("x-razorpay-event-id");
		expect(webhookRoute.indexOf("verifyRazorpayWebhookSignature")).toBeLessThan(
			webhookRoute.indexOf("JSON.parse(rawBody.toString(\"utf8\"))"),
		);
		expect(webhookProcessor).toContain("providerEventId?: string | null");
	});
});

describe("Razorpay donation boundaries", () => {
	test("validates Razorpay amount and currency before marking paid state", () => {
		expect(
			validateRazorpayAmount({
				amount: 50000,
				currency: "INR",
				expectedAmountPaise: 50000,
			}),
		).toEqual({ valid: true, reason: "ok" });
		expect(
			validateRazorpayAmount({
				amount: 100,
				currency: "INR",
				expectedAmountPaise: 50000,
			}),
		).toEqual({ valid: false, reason: "wrong_amount" });
		expect(
			validateRazorpayAmount({
				amount: 50000,
				currency: "USD",
				expectedAmountPaise: 50000,
			}),
		).toEqual({ valid: false, reason: "wrong_currency" });
	});

	test("webhook processor is donation-only and never provisions private server", () => {
		expect(webhookProcessor).toContain("processDonationEvent");
		expect(webhookProcessor).toContain("processFailedDonationPaymentEvent");
		expect(webhookProcessor).toContain("processRefundEvent");
		expect(webhookProcessor).toContain("validateRazorpayAmount");
		expect(webhookProcessor).not.toContain("subscription.");
		expect(webhookProcessor).not.toContain("planEntitlements");
		expect(webhookProcessor).not.toContain("ensureDedicatedWorkerProvisioningJob");
		expect(webhookProcessor).not.toContain("private_worker");
		expect(donationVerifyRoute).toContain("fetchRazorpayPayment");
		expect(donationVerifyRoute).toContain('providerPayment.status !== "captured"');
		expect(razorpayModule).not.toContain("/subscriptions");
		expect(razorpayModule).not.toContain("verifyRazorpaySubscriptionPaymentSignature");
		expect(razorpayModule).toContain("rzp_test_");
		expect(razorpayModule).toContain("rzp_live_");
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

describe("private server request flow", () => {
	test("private server is sales-assisted annual pricing", () => {
		expect(PRIVATE_SERVER_PRODUCT.indicativePriceInr).toBe(10000);
		expect(PRIVATE_SERVER_PRODUCT.salesAssisted).toBe(true);
		expect(PRIVATE_SERVER_PRICE_LABEL).toBe("₹10,000/year");
		expect(pricingPage).toContain("PRIVATE_SERVER_PRICE_LABEL");
		expect(pricingPage).toContain("Indicative annual pricing");
		expect(pricingPage).toContain("PrivateServerRequestButton");
		expect(pricingPage).not.toContain("PrivateServerCheckoutButton");
	});

	test("request form opens from CTA and never invokes Razorpay", () => {
		expect(requestForm).toContain("Talk to Team");
		expect(requestForm).toContain("Request Private Server");
		expect(requestForm).toContain("Send Request");
		expect(requestForm).toContain("/api/private-server/request");
		expect(requestForm).toContain("consentToContact");
		expect(requestForm).toContain("websiteConfirmation");
		expect(requestForm).not.toContain("Razorpay");
		expect(requestForm).not.toContain("checkout");
		expect(requestForm).not.toContain("subscription");
	});

	test("server-side request validation rejects manipulated payloads", () => {
		const valid = privateServerRequestSchema.parse({
			fullName: "Sandeep",
			email: "SALES@EXAMPLE.COM ",
			companyName: "Capinsta",
			monthlyWorkload: "10,000-50,000 jobs/month",
			primaryUseCase: "Caption processing",
			message: "Need dedicated capacity.",
			consentToContact: true,
		});
		expect(valid.email).toBe("sales@example.com");
		expect(
			privateServerRequestSchema.safeParse({
				...valid,
				monthlyWorkload: "one billion fake jobs",
			}).success,
		).toBe(false);
		expect(
			privateServerRequestSchema.safeParse({ ...valid, consentToContact: false }).success,
		).toBe(false);
		expect(
			privateServerRequestSchema.safeParse({ ...valid, websiteConfirmation: "spam" }).success,
		).toBe(false);
	});

	test("request API is server-owned and does not create payment or entitlement records", () => {
		expect(requestRoute).toContain("checkRateLimit");
		expect(requestRoute).toContain("requireCsrfProtection");
		expect(requestRoute).toContain("privateServerRequestSchema");
		expect(requestRoute).toContain("privateServerRequests");
		expect(requestRoute).toContain("supabase.auth.getUser()");
		expect(requestRoute).toContain("ADMIN_SECURITY_PEPPER");
		expect(requestRoute).not.toContain("createDonationOrder");
		expect(requestRoute).not.toContain("Razorpay");
		expect(requestRoute).not.toContain("subscriptions");
		expect(requestRoute).not.toContain("planEntitlements");
		expect(requestRoute).not.toContain("dedicatedWorkerProvisioningJobs");
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
		expect(DONATION_TIERS).toHaveLength(9);
		expect(donatePage).toContain("DONATION_TIERS.map");
		expect(donatePage).toContain("donationTierId");
		for (const tier of DONATION_TIERS) {
			expect(tier.amountPaise).toBe(tier.amountInr * 100);
			expect(tier.id).toMatch(/^[a-z0-9_]+$/);
		}
	});

	test("client-side donation checkout never grants paid features", () => {
		expect(checkoutButton).not.toContain("planEntitlements");
		expect(checkoutButton).not.toContain("private_server");
		expect(checkoutButton).not.toContain("/api/payments/private-server");
		expect(checkoutButton).toContain("/api/payments/donations/verify");
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

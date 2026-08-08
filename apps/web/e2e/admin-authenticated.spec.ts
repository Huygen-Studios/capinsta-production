import { createHmac } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

type Credentials = { email: string; password: string };
const credentials = {
  normal: readCredentials("NORMAL"),
  suspended: readCredentials("SUSPENDED"),
  support: readCredentials("SUPPORT"),
  operations: readCredentials("OPERATIONS"),
  analyst: readCredentials("ANALYST"),
  superAdmin: readCredentials("SUPER_ADMIN"),
};
const configured = Object.values(credentials).every(Boolean);

function readCredentials(role: string): Credentials | null {
  const email = process.env[`ADMIN_E2E_${role}_EMAIL`];
  const password = process.env[`ADMIN_E2E_${role}_PASSWORD`];
  return email && password ? { email, password } : null;
}

function decodeBase32(secret: string) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const character of secret.replaceAll(" ", "").toUpperCase()) {
    const index = alphabet.indexOf(character);
    if (index >= 0) bits += index.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
}

function totp(secret: string, time = Date.now()) {
  const counter = Math.floor(time / 30_000);
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", decodeBase32(secret))
    .update(buffer)
    .digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return value.toString().padStart(6, "0");
}

async function primaryLogin(page: Page, account: Credentials) {
  await page.goto("/admincapinsta11/login");
  await page.getByLabel("Email").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Continue securely" }).click();
}

async function completeMfa(page: Page) {
  await expect(page).toHaveURL(/\/admincapinsta11\/mfa/);
  const secretText = await page
    .locator("p.font-mono")
    .textContent()
    .catch(() => null);
  if (!secretText) {
    test.skip(
      true,
      "Existing-factor challenge requires ADMIN_E2E_*_TOTP_SECRET provisioning.",
    );
    return;
  }
  await page.getByLabel("Authentication code").fill("000000");
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page.getByRole("alert")).toContainText("Verification failed");
  await page.getByLabel("Authentication code").fill(totp(secretText));
  await page.getByRole("button", { name: "Verify and continue" }).click();
  await expect(page).toHaveURL(/\/admincapinsta11\/overview/);
}

test.describe.configure({ mode: "serial" });
test.skip(
  !configured,
  "Set isolated ADMIN_E2E_* staging credentials to run authenticated admin tests.",
);

test("normal user and suspended user cannot access admin data", async ({
  browser,
}) => {
  for (const account of [credentials.normal!, credentials.suspended!]) {
    const page = await browser.newPage();
    await primaryLogin(page, account);
    await expect(page).not.toHaveURL(/\/overview/);
    await page.close();
  }
});

test("AAL1 super-admin enrolls MFA, rejects invalid TOTP, reaches dashboard, and logs out", async ({
  page,
}) => {
  await primaryLogin(page, credentials.superAdmin!);
  await completeMfa(page);
  await expect(page.getByText("Operational overview")).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/admincapinsta11\/login/);
  await page.goto("/admincapinsta11/overview");
  await expect(page).not.toHaveURL(/\/overview/);
});

test("role restrictions are enforced by pages and direct mutation APIs", async ({
  browser,
}) => {
  for (const [role, account, forbiddenPath] of [
    ["support", credentials.support!, "/admincapinsta11/feature-flags"],
    ["analyst", credentials.analyst!, "/admincapinsta11/security"],
  ] as const) {
    const page = await browser.newPage();
    await primaryLogin(page, account);
    await completeMfa(page);
    await page.goto(forbiddenPath);
    await expect(page.getByText("This page could not be found")).toBeVisible();
    const response = await page.request.post("/api/admin/mutations", {
      data: {
        action: "feature_flag.update",
        targetId: "export_enabled",
        enabled: false,
        reason: `forbidden ${role} test`,
      },
      headers: {
        Origin: process.env.ADMIN_E2E_BASE_URL ?? "http://127.0.0.1:3000",
      },
    });
    expect(response.status()).toBeGreaterThanOrEqual(400);
    await page.close();
  }
});

test("mobile admin navigation remains usable", async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await primaryLogin(page, credentials.operations!);
  await completeMfa(page);
  await expect(
    page.getByRole("navigation", { name: "Admin navigation" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Caption jobs" }).click();
  await expect(page).toHaveURL(/caption-jobs/);
});

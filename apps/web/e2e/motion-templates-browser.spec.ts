import { expect, test, type Page } from "@playwright/test";

const baseURL = process.env.CAPINSTA_QA_URL ?? "http://127.0.0.1:3000";

type Diagnostics = {
	consoleErrors: string[];
	pageErrors: string[];
	failedRequests: string[];
	responses: string[];
};

function attachDiagnostics({ page }: { page: Page }): Diagnostics {
	const diagnostics: Diagnostics = {
		consoleErrors: [],
		pageErrors: [],
		failedRequests: [],
		responses: [],
	};

	page.on("console", (message) => {
		if (message.type() === "error") {
			diagnostics.consoleErrors.push(message.text());
		}
	});
	page.on("pageerror", (error) => {
		diagnostics.pageErrors.push(error.message);
	});
	page.on("requestfailed", (request) => {
		diagnostics.failedRequests.push(
			`${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`,
		);
	});
	page.on("response", (response) => {
		const status = response.status();
		if (status >= 400) {
			diagnostics.responses.push(`${status} ${response.url()}`);
		}
	});

	return diagnostics;
}

async function preparePage({ page }: { page: Page }): Promise<void> {
	await page.addInitScript(() => {
		localStorage.setItem("theme", "dark");
		localStorage.setItem("hasSeenOnboarding", "true");
		localStorage.setItem("capinsta-editor-onboarding:v1", "true");
		localStorage.setItem(
			"capinsta-cookie-consent",
			JSON.stringify({
				necessary: true,
				analytics: false,
				advertising: false,
				updatedAt: new Date().toISOString(),
			}),
		);
	});
}

async function dumpDiagnostics({
	page,
	diagnostics,
}: {
	page: Page;
	diagnostics: Diagnostics;
}): Promise<void> {
	const bodyHtml = await page
		.locator("body")
		.evaluate((body) => body.innerHTML.slice(0, 4_000))
		.catch((error: unknown) =>
			error instanceof Error ? error.message : String(error),
		);
	console.log(
		JSON.stringify(
			{
				url: page.url(),
				consoleErrors: diagnostics.consoleErrors,
				pageErrors: diagnostics.pageErrors,
				failedRequests: diagnostics.failedRequests,
				responses: diagnostics.responses,
				bodyHtml,
			},
			null,
			2,
		),
	);
}

async function createProjectAndOpenEditor({
	page,
	onEditorPage,
}: {
	page: Page;
	onEditorPage?: (page: Page) => void;
}): Promise<Page> {
	await preparePage({ page });
	await page.goto(`${baseURL}/projects`, { waitUntil: "domcontentloaded" });
	await expect(page.getByRole("button", { name: "New project" })).toBeVisible({
		timeout: 30_000,
	});
	await page.waitForLoadState("networkidle", { timeout: 30_000 });
	await page.getByRole("button", { name: "New project" }).click();
	await page
		.waitForURL(/\/editor\/[^/]+$/, { timeout: 5_000 })
		.catch(async () => {
			const projectLink = page.locator('a[href^="/editor/"]').first();
			await expect(projectLink).toBeVisible({ timeout: 60_000 });
			const href = await projectLink.getAttribute("href");
			expect(href).not.toBeNull();
			const editorPage = await page.context().newPage();
			onEditorPage?.(editorPage);
			await preparePage({ page: editorPage });
			await editorPage
				.goto(`${baseURL}${href}`, { waitUntil: "domcontentloaded" })
				.catch((error: unknown) => {
					if (
						!(error instanceof Error) ||
						!error.message.includes("net::ERR_ABORTED")
					) {
						throw error;
					}
				});
			page = editorPage;
		});
	await expect(page.getByTestId("editor-ready")).toBeVisible({
		timeout: 60_000,
	});
	return page;
}

test("creates a project, opens Templates, and adds Position Dance", async ({
	page,
}) => {
	test.setTimeout(180_000);
	const diagnostics = attachDiagnostics({ page });
	let activePage = page;
	let activeDiagnostics = diagnostics;

	try {
		const editorPage = await createProjectAndOpenEditor({
			page,
			onEditorPage: (nextPage) => {
				activePage = nextPage;
				activeDiagnostics = attachDiagnostics({ page: nextPage });
			},
		});
		activePage = editorPage;
		await editorPage.getByRole("button", { name: "Templates" }).click();
		await expect(editorPage.getByTestId("templates-panel")).toBeVisible();

		const positionDance = editorPage
			.getByTestId("template-card")
			.filter({ hasText: "Position Dance" });
		await positionDance.click();
		await editorPage.getByTestId("template-add-button").click();
		await expect(
			editorPage.getByTestId("motion-template-timeline-element"),
		).toHaveCount(1);
		await editorPage.getByTestId("motion-template-timeline-element").click();
		await expect(editorPage.getByTestId("template-inspector")).toBeVisible();
	} catch (error) {
		await dumpDiagnostics({ page: activePage, diagnostics: activeDiagnostics });
		throw error;
	}
});

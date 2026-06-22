import { beforeEach, describe, expect, mock, test } from "bun:test";

const valuesMock = mock(async (_value: unknown) => undefined);
const insertMock = mock((_table: unknown) => ({ values: valuesMock }));

mock.module("@/db", () => ({
	db: { insert: insertMock },
	supportCases: { table: "support_cases" },
}));

const { submitFeedback } = await import("./queries");

describe("submitFeedback", () => {
	beforeEach(() => {
		insertMock.mockClear();
		valuesMock.mockClear();
	});

	test("writes new feedback directly to the admin support-case read model", async () => {
		const entry = await submitFeedback({
			message: "Video is laggy",
			userId: "00000000-0000-4000-8000-000000000001",
			email: "user@example.com",
			page: "https://capinsta.example/editor/project-1",
			browser: "Test Browser",
			appVersion: "commit-sha",
		});

		expect(insertMock).toHaveBeenCalledTimes(1);
		expect(valuesMock).toHaveBeenCalledTimes(1);
		expect(valuesMock.mock.calls[0]?.[0]).toMatchObject({
			id: entry.id,
			message: "Video is laggy",
			userId: "00000000-0000-4000-8000-000000000001",
			emailSnapshot: "user@example.com",
			status: "new",
			priority: "normal",
			page: "https://capinsta.example/editor/project-1",
			browser: "Test Browser",
			appVersion: "commit-sha",
		});
	});

	test("supports anonymous feedback without inventing an owner", async () => {
		await submitFeedback({ message: "Please add a shortcut" });

		expect(valuesMock.mock.calls[0]?.[0]).toMatchObject({
			userId: null,
			emailSnapshot: null,
			message: "Please add a shortcut",
		});
	});
});

import { db, supportCases } from "@/db";
import { generateUUID } from "@/utils/id";
import type { FeedbackEntry, SubmitFeedbackInput } from "./types";
import { validateFeedbackMessage } from "./validation";

export async function submitFeedback({
	message,
	userId,
	email,
	page,
	browser,
	appVersion,
}: SubmitFeedbackInput): Promise<FeedbackEntry> {
	const validation = validateFeedbackMessage(message);
	if (!validation.ok) {
		throw new Error(validation.message);
	}
	const id = generateUUID();
	const now = new Date();

	await db.insert(supportCases).values({
		id,
		userId: userId || null,
		emailSnapshot: email || null,
		message,
		category: "general",
		status: "new",
		priority: "normal",
		page: page || null,
		browser: browser || null,
		appVersion: appVersion || null,
		createdAt: now,
		updatedAt: now,
	});

	return { id, message, createdAt: now.toISOString() };
}

import { db, feedback, supportCases } from "@/db";
import { generateUUID } from "@/utils/id";
import type { FeedbackEntry, SubmitFeedbackInput } from "./types";

export async function submitFeedback({
	message,
}: SubmitFeedbackInput): Promise<FeedbackEntry> {
	const id = generateUUID();
	const now = new Date();

	await db.transaction(async (tx) => {
		await tx.insert(feedback).values({ id, message, createdAt: now });
		await tx.insert(supportCases).values({
			id,
			message,
			category: "general",
			status: "new",
			priority: "normal",
			createdAt: now,
			updatedAt: now,
		});
	});

	return { id, message, createdAt: now.toISOString() };
}

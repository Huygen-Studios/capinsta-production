export const MAX_MESSAGE_LENGTH = 5000;

export interface FeedbackEntry {
	id: string;
	message: string;
	createdAt: string;
}

export interface SubmitFeedbackInput {
	message: string;
	userId?: string | null;
	email?: string | null;
	page?: string | null;
	browser?: string | null;
	appVersion?: string | null;
}

import "server-only";

import { db } from "@/db";
import { productEvents } from "@/db/schema";
import { webEnv } from "@/env/web";
import { sanitizeProductEventMetadata } from "./sanitize";

export const PRODUCT_EVENT_NAMES = [
	"signup_completed",
	"project_created",
	"media_upload_completed",
	"media_upload_failed",
	"caption_job_started",
	"caption_job_completed",
	"caption_job_failed",
	"export_started",
	"export_completed",
	"export_failed",
	"private_server_request_submitted",
	"donation_completed",
	"donation_failed",
	"donation_refunded",
] as const;

export type ProductEventName = (typeof PRODUCT_EVENT_NAMES)[number];

function eventEnvironment() {
	return webEnv.NODE_ENV === "production" ? "production" : webEnv.NODE_ENV;
}

export async function recordProductEvent({
	eventName,
	eventKey,
	occurredAt = new Date(),
	userId,
	projectId,
	mediaAssetId,
	captionJobId,
	exportJobId,
	metadata,
}: {
	eventName: ProductEventName;
	eventKey: string;
	occurredAt?: Date;
	userId?: string | null;
	projectId?: string | null;
	mediaAssetId?: string | null;
	captionJobId?: string | null;
	exportJobId?: string | null;
	metadata?: Record<string, unknown>;
}) {
	await db
		.insert(productEvents)
		.values({
			eventName,
			eventKey,
			occurredAt,
			userId: userId ?? null,
			projectId: projectId ?? null,
			mediaAssetId: mediaAssetId ?? null,
			captionJobId: captionJobId ?? null,
			exportJobId: exportJobId ?? null,
			environment: eventEnvironment(),
			metadata: sanitizeProductEventMetadata({ metadata }),
		})
		.onConflictDoNothing({ target: productEvents.eventKey });
}

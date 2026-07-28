import type { ServerBackedMediaDescriptorV1 } from "@capinsta/transcript-contract";
import { z } from "zod";
import { authenticatedFetch } from "@/lib/supabase/authenticated-fetch";
import { buildCapinstaApiUrl } from "@/capinsta/api-url";
import { getCapinstaApiBaseUrl } from "@/capinsta/featureFlags";

export interface MediaAccessV1 {
	mediaAssetId: string;
	mediaId: string;
	accessMode: "signed-url";
	url: string;
	expiresAt: string;
	mimeType: string | null;
	sizeBytes: number | null;
	durationMs: number;
}

type CacheEntry = { value: MediaAccessV1; expiresAtMs: number };
const mediaAccessSchema: z.ZodType<MediaAccessV1> = z.object({
	mediaAssetId: z.string().min(1),
	mediaId: z.string().min(1),
	accessMode: z.literal("signed-url"),
	url: z.url(),
	expiresAt: z.iso.datetime(),
	mimeType: z.string().nullable(),
	sizeBytes: z.number().int().nonnegative().nullable(),
	durationMs: z.number().int().nonnegative(),
});

export class ServerBackedMediaAccessResolver {
	private cache = new Map<string, CacheEntry>();
	private pending = new Map<string, Promise<MediaAccessV1>>();
	private readonly refreshWindowMs = 60_000;

	constructor(
		private readonly fetchAccess: (
			mediaAssetId: string,
		) => Promise<MediaAccessV1> = defaultFetchAccess,
	) {}

	async resolve({
		mediaAssetId,
	}: {
		mediaAssetId: string;
	}): Promise<MediaAccessV1> {
		const cached = this.cache.get(mediaAssetId);
		if (cached && cached.expiresAtMs - Date.now() > this.refreshWindowMs) {
			return cached.value;
		}
		const existing = this.pending.get(mediaAssetId);
		if (existing) return existing;
		const request = this.fetchAccess(mediaAssetId)
			.then((value) => {
				if (
					value.mediaAssetId !== mediaAssetId ||
					value.mediaId !== mediaAssetId ||
					value.accessMode !== "signed-url" ||
					!value.url ||
					!Number.isFinite(Date.parse(value.expiresAt))
				) {
					throw new Error("media_attachment_invalid");
				}
				this.cache.set(mediaAssetId, {
					value,
					expiresAtMs: Date.parse(value.expiresAt),
				});
				return value;
			})
			.finally(() => this.pending.delete(mediaAssetId));
		this.pending.set(mediaAssetId, request);
		return request;
	}

	async materializeFile({
		descriptor,
	}: {
		descriptor: ServerBackedMediaDescriptorV1;
	}): Promise<{ file: File; url: string }> {
		const access = await this.resolve({
			mediaAssetId: descriptor.mediaAssetId,
		});
		if (access.mediaId !== descriptor.mediaId) {
			throw new Error("media_attachment_invalid");
		}
		// The zero-byte File preserves the existing local-media shape. Network
		// decoders use the ephemeral URL directly with range requests.
		return {
			file: new File([], descriptor.displayName, {
				type: descriptor.mimeType ?? access.mimeType ?? "",
			}),
			url: access.url,
		};
	}

	clear(mediaAssetId?: string): void {
		if (mediaAssetId) {
			this.cache.delete(mediaAssetId);
			return;
		}
		this.cache.clear();
	}
}

async function defaultFetchAccess(
	mediaAssetId: string,
): Promise<MediaAccessV1> {
	const url = buildCapinstaApiUrl({
		baseUrl: getCapinstaApiBaseUrl(),
		path: `/capinsta/media/${encodeURIComponent(mediaAssetId)}/access`,
	});
	const response = await authenticatedFetch(url, {
		method: "POST",
		cache: "no-store",
	});
	if (!response.ok) throw new Error("media_access_unavailable");
	return mediaAccessSchema.parse(await response.json());
}

export const serverBackedMediaAccessResolver =
	new ServerBackedMediaAccessResolver();

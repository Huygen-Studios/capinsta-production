const JSON_CONTENT_TYPE_PATTERN = /^(application\/json|[^;]+\+json)(?:;|$)/i;
const TEXT_CONTENT_TYPE_PATTERN =
	/^(text\/[^;]+|application\/(xml|xhtml\+xml|javascript|problem\+json))(?:;|$)/i;
const MAX_PREVIEW_CHARACTERS = 240;
const MAX_PREVIEW_BYTES = 32;

function normalizedContentType(response: Response): string {
	return response.headers.get("content-type")?.trim() || "unknown";
}

function safeTextPreview(value: string): string {
	return Array.from(value.slice(0, MAX_PREVIEW_CHARACTERS))
		.map((character) => {
			const code = character.charCodeAt(0);
			return (code >= 0 && code <= 8) ||
				code === 11 ||
				code === 12 ||
				(code >= 14 && code <= 31) ||
				code === 127
				? "\uFFFD"
				: character;
		})
		.join("");
}

function bytePreview(bytes: Uint8Array): string {
	return Array.from(bytes.slice(0, MAX_PREVIEW_BYTES), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join(" ");
}

function diagnosticMessage({
	endpoint,
	response,
	contentType,
	preview,
	reason,
}: {
	endpoint: string;
	response: Response;
	contentType: string;
	preview: string;
	reason: string;
}): string {
	const correlationId =
		response.headers.get("x-correlation-id") ??
		response.headers.get("x-request-id") ??
		"unavailable";
	return [
		reason,
		`endpoint=${endpoint}`,
		`status=${response.status}`,
		`content-type=${contentType}`,
		`correlation=${correlationId}`,
		`response-preview=${preview || "(empty)"}`,
	].join(" | ");
}

export class CapinstaResponseFormatError extends Error {
	// eslint-disable-next-line opencut/prefer-object-params -- Error subclasses follow the standard Error(message) constructor.
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message);
		this.name = "CapinstaResponseFormatError";
	}
}

export async function readJsonApiResponse<T>({
	response,
	endpoint,
}: {
	response: Response;
	endpoint: string;
}): Promise<T> {
	const contentType = normalizedContentType(response);
	const bytes = new Uint8Array(await response.arrayBuffer());

	if (!JSON_CONTENT_TYPE_PATTERN.test(contentType)) {
		const preview = TEXT_CONTENT_TYPE_PATTERN.test(contentType)
			? safeTextPreview(new TextDecoder().decode(bytes))
			: `[binary bytes: ${bytePreview(bytes)}]`;
		throw new CapinstaResponseFormatError(
			diagnosticMessage({
				endpoint,
				response,
				contentType,
				preview,
				reason: "Capinsta returned a non-JSON response.",
			}),
			response.status,
		);
	}

	let text: string;
	try {
		text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
	} catch {
		throw new CapinstaResponseFormatError(
			diagnosticMessage({
				endpoint,
				response,
				contentType,
				preview: `[non-UTF-8 bytes: ${bytePreview(bytes)}]`,
				reason: "Capinsta returned JSON with invalid UTF-8 bytes.",
			}),
			response.status,
		);
	}

	try {
		const parsed: unknown = JSON.parse(text);
		// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- The caller supplies the endpoint contract type after the runtime JSON boundary.
		return parsed as T;
	} catch {
		throw new CapinstaResponseFormatError(
			diagnosticMessage({
				endpoint,
				response,
				contentType,
				preview: safeTextPreview(text),
				reason: "Capinsta returned malformed JSON.",
			}),
			response.status,
		);
	}
}

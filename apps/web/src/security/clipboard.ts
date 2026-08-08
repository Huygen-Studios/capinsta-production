const BIDI_AND_INVISIBLE_CONTROLS =
	/[\u061C\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;
const UNSAFE_ASCII_CONTROLS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const JWT_LIKE_TOKEN = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/gi;
const SECRET_ASSIGNMENT =
	/\b(password|passwd|secret|api[_-]?key|token|access[_-]?token|refresh[_-]?token|session|signature|signed[_-]?url)=([^\s&]+)/gi;
const SIGNED_URL_PARAM =
	/([?&](?:X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token|Signature|Expires|Key-Pair-Id|Policy)=)[^&\s]+/gi;

export function sanitizeClipboardText(value: string): string {
	return value
		.replace(BIDI_AND_INVISIBLE_CONTROLS, "")
		.replace(UNSAFE_ASCII_CONTROLS, "")
		.replace(BEARER_TOKEN, "Bearer [redacted-token]")
		.replace(SECRET_ASSIGNMENT, (_match, key: string) => `${key}=[redacted]`)
		.replace(JWT_LIKE_TOKEN, "[redacted-token]")
		.replace(SIGNED_URL_PARAM, "$1[redacted]");
}

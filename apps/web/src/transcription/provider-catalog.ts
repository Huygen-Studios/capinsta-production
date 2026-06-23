export type TranscriptionProvider = "gemini" | "openai" | "sarvam";
export type TimestampStrategy =
	| "provider_word"
	| "structured_word_validate"
	| "local_forced_alignment";

export type ProviderMode = "transcribe" | "verbatim" | "translit" | "codemix";

export type TranscriptionCatalogEntry = {
	provider: TranscriptionProvider;
	model: string;
	displayName: string;
	enabled: boolean;
	timestampCapability: string;
	timestampStrategy: TimestampStrategy;
	requiredSecret: "GEMINI_API_KEY" | "OPENAI_API_KEY" | "SARVAM_API_KEY";
	supportedResponseFormats: string[];
	maxInputBytes: number;
	maxChunkDurationSeconds: number;
	supportedLanguageModes: string[];
	supportedProviderModes: ProviderMode[];
	localAlignmentRequired: boolean;
	retryableHttpStatuses: number[];
};

export const TRANSCRIPTION_PROVIDER_CATALOG = [
	{
		provider: "gemini",
		model: "gemini-3.5-flash",
		displayName: "Gemini 3.5 Flash",
		enabled: true,
		timestampCapability: "Structured model timestamps with local validation",
		timestampStrategy: "structured_word_validate",
		requiredSecret: "GEMINI_API_KEY",
		supportedResponseFormats: ["application/json"],
		maxInputBytes: 2_000_000_000,
		maxChunkDurationSeconds: 600,
		supportedLanguageModes: ["english", "hindi", "hinglish", "telugu", "telgish", "auto_mixed_indian"],
		supportedProviderModes: ["transcribe"],
		localAlignmentRequired: false,
		retryableHttpStatuses: [429, 500, 503, 504],
	},
	{
		provider: "gemini",
		model: "gemini-2.5-flash",
		displayName: "Gemini 2.5 Flash",
		enabled: true,
		timestampCapability: "Structured model timestamps with local validation",
		timestampStrategy: "structured_word_validate",
		requiredSecret: "GEMINI_API_KEY",
		supportedResponseFormats: ["application/json"],
		maxInputBytes: 2_000_000_000,
		maxChunkDurationSeconds: 600,
		supportedLanguageModes: ["english", "hindi", "hinglish", "telugu", "telgish", "auto_mixed_indian"],
		supportedProviderModes: ["transcribe"],
		localAlignmentRequired: false,
		retryableHttpStatuses: [429, 500, 503, 504],
	},
	{
		provider: "openai",
		model: "whisper-1",
		displayName: "OpenAI Whisper",
		enabled: true,
		timestampCapability: "Native provider word timestamps",
		timestampStrategy: "provider_word",
		requiredSecret: "OPENAI_API_KEY",
		supportedResponseFormats: ["verbose_json"],
		maxInputBytes: 25_000_000,
		maxChunkDurationSeconds: 600,
		supportedLanguageModes: ["english", "hindi", "hinglish", "telugu", "telgish", "auto_mixed_indian"],
		supportedProviderModes: ["transcribe"],
		localAlignmentRequired: false,
		retryableHttpStatuses: [429, 500, 503, 504],
	},
	{
		provider: "openai",
		model: "gpt-4o-mini-transcribe",
		displayName: "OpenAI GPT-4o Mini Transcribe",
		enabled: true,
		timestampCapability: "Transcript text with Capinsta local word alignment",
		timestampStrategy: "local_forced_alignment",
		requiredSecret: "OPENAI_API_KEY",
		supportedResponseFormats: ["json"],
		maxInputBytes: 25_000_000,
		maxChunkDurationSeconds: 600,
		supportedLanguageModes: ["english", "hindi", "hinglish", "telugu", "telgish", "auto_mixed_indian"],
		supportedProviderModes: ["transcribe"],
		localAlignmentRequired: true,
		retryableHttpStatuses: [429, 500, 503, 504],
	},
	{
		provider: "openai",
		model: "gpt-4o-transcribe",
		displayName: "OpenAI GPT-4o Transcribe",
		enabled: true,
		timestampCapability: "Transcript text with Capinsta local word alignment",
		timestampStrategy: "local_forced_alignment",
		requiredSecret: "OPENAI_API_KEY",
		supportedResponseFormats: ["json"],
		maxInputBytes: 25_000_000,
		maxChunkDurationSeconds: 600,
		supportedLanguageModes: ["english", "hindi", "hinglish", "telugu", "telgish", "auto_mixed_indian"],
		supportedProviderModes: ["transcribe"],
		localAlignmentRequired: true,
		retryableHttpStatuses: [429, 500, 503, 504],
	},
	{
		provider: "sarvam",
		model: "saaras:v3",
		displayName: "Sarvam Saaras v3",
		enabled: true,
		timestampCapability: "Native provider word timestamps",
		timestampStrategy: "provider_word",
		requiredSecret: "SARVAM_API_KEY",
		supportedResponseFormats: ["json"],
		maxInputBytes: 25_000_000,
		maxChunkDurationSeconds: 25,
		supportedLanguageModes: ["english", "hindi", "hinglish", "telugu", "telgish", "auto_mixed_indian"],
		supportedProviderModes: ["transcribe", "verbatim", "translit", "codemix"],
		localAlignmentRequired: false,
		retryableHttpStatuses: [429, 500, 503],
	},
] as const satisfies readonly TranscriptionCatalogEntry[];

export function isTranscriptionProvider(value: string): value is TranscriptionProvider {
	return value === "gemini" || value === "openai" || value === "sarvam";
}

export function getTranscriptionCatalogEntry({
	provider,
	model,
}: {
	provider: string;
	model: string;
}) {
	return TRANSCRIPTION_PROVIDER_CATALOG.find(
		(entry) => entry.provider === provider && entry.model === model && entry.enabled,
	);
}

export function defaultProviderOptions(provider: TranscriptionProvider) {
	if (provider === "sarvam") {
		return {
			mode: "transcribe",
			languageStrategy: "language_mode_mapping",
		};
	}
	return {};
}

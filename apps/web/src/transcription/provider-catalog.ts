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
	productionReady?: boolean;
	reason?: string | null;
	message?: string | null;
};

export const TRANSCRIPTION_PROVIDER_CATALOG = [
	{
		provider: "gemini",
		model: "gemini-3.5-flash",
		displayName: "Gemini 3.5 Flash",
		enabled: true,
		timestampCapability: "Transcript text with Capinsta local word alignment",
		timestampStrategy: "local_forced_alignment",
		requiredSecret: "GEMINI_API_KEY",
		supportedResponseFormats: ["application/json"],
		maxInputBytes: 2_000_000_000,
		maxChunkDurationSeconds: 600,
		supportedLanguageModes: ["english", "hindi", "hinglish", "telugu", "telgish", "auto_mixed_indian"],
		supportedProviderModes: ["transcribe"],
		localAlignmentRequired: true,
		retryableHttpStatuses: [429, 500, 503, 504],
	},
	{
		provider: "gemini",
		model: "gemini-2.5-flash",
		displayName: "Gemini 2.5 Flash",
		enabled: true,
		timestampCapability: "Transcript text with Capinsta local word alignment",
		timestampStrategy: "local_forced_alignment",
		requiredSecret: "GEMINI_API_KEY",
		supportedResponseFormats: ["application/json"],
		maxInputBytes: 2_000_000_000,
		maxChunkDurationSeconds: 600,
		supportedLanguageModes: ["english", "hindi", "hinglish", "telugu", "telgish", "auto_mixed_indian"],
		supportedProviderModes: ["transcribe"],
		localAlignmentRequired: true,
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

export const DEFAULT_PIPELINE_OPTIONS = {
	schemaVersion: 1,
	timingSourcePolicy: "native_then_forced",
	audio: { sampleRate: 16000, channels: 1, codec: "pcm_s16le", bitrateKbps: null },
	audioChunking: {
		vadEnabled: true,
		targetSeconds: 15,
		maxSeconds: 25,
		paddingSeconds: 0.08,
		legacyNormalSeconds: 20,
		legacyNormalOverlapSeconds: 4,
		legacyStrictSeconds: 12,
		legacyStrictOverlapSeconds: 5,
		fadeMs: 0,
	},
	vad: {
		pauseThresholdSeconds: 0.3,
		silenceThresholdDb: null,
		sileroEnabled: false,
		sileroSpeechThreshold: 0.5,
		speechMergeGapSeconds: null,
	},
	alignment: {
		provider: "auto",
		whisperxEnabled: false,
		stableTsEnabled: false,
		stableTsModel: "base",
		stableTsDevice: "auto",
		stableTsMinMatchCoverage: 0.5,
		stableTsMinWordRatio: 0.45,
		stableTsMaxWordRatio: 2.25,
		allowStableTsOrderFallback: false,
	},
	repair: {
		speechSpanRetimerEnabled: true,
		minimumWordDurationSeconds: 0.04,
		minimumInterWordGapSeconds: 0,
		cadenceMinSeconds: 0.075,
		cadenceMaxSeconds: 0.35,
		minimumSpeechRetimeWords: 6,
		minimumSpeechRetimeTrailingGapSeconds: 1,
		speechRetimeCompressionRatio: 0.78,
		minimumPhraseRetimeWords: 4,
	},
	autoSync: {
		enabled: false,
		frameStepSeconds: 0.02,
		maxShiftSeconds: 2,
		minScore: 0.58,
		minImprovement: 0.04,
		maxEstimatedWordRatio: 0.7,
		allowSkew: false,
		maxSkewDelta: 0.02,
	},
	captionChunking: {
		targetWords: 4,
		maxWords: 5,
		minWords: 2,
		maxCharacters: 36,
		minDurationSeconds: 0.8,
		maxDurationSeconds: 3,
		pauseSplitThresholdSeconds: 0.3,
		mergeGapSeconds: 0.12,
		phraseHoldSeconds: 0.12,
	},
	quality: {
		minimumProviderTimestampCoverage: 0.9,
		allowSegmentDerivedWords: false,
		allowEstimatedWords: false,
		maximumEstimatedWordRatio: 0.05,
	},
	performance: { providerTimeoutSeconds: 60, sarvamMaxConcurrency: 2, alignmentRetries: 3 },
} as const;

type PlainObject = { readonly [key: string]: unknown };

function isPlainObject(value: unknown): value is PlainObject {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

// eslint-disable-next-line opencut/prefer-object-params
export function mergePipelineOptions(
	base: PlainObject = DEFAULT_PIPELINE_OPTIONS,
	overrides: PlainObject = {},
): Record<string, unknown> {
	const merged: Record<string, unknown> = { ...base };
	for (const [key, value] of Object.entries(overrides)) {
		if (key === "__proto__" || key === "constructor" || key === "prototype") {
			continue;
		}
		const baseValue = merged[key];
		merged[key] =
			isPlainObject(baseValue) && isPlainObject(value)
				? mergePipelineOptions(baseValue, value)
				: value;
	}
	return merged;
}

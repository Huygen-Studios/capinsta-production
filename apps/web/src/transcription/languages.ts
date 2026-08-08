export const LANGUAGES = [
	{ code: "english", name: "English" },
	{ code: "hindi", name: "Hindi" },
	{ code: "telugu", name: "Telugu" },
	{ code: "hinglish", name: "Hinglish" },
	{ code: "telgish", name: "Telgish (Telugu + English)" },
] as const;

export type Language = (typeof LANGUAGES)[number];
export type LanguageCode = Language["code"];

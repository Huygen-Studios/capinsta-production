export interface KeywordPageDefinition {
	slug: string;
	title: string;
	description: string;
	headline: string;
	intro: string;
	points: { title: string; description: string }[];
}

export const KEYWORD_PAGES: KeywordPageDefinition[] = [
	{
		slug: "caption-generator",
		title: "Caption generator for video",
		description: "Generate, edit, style, and export accurate video captions in a focused browser workflow.",
		headline: "A caption generator built for the edit after transcription.",
		intro: "Capinsta helps you generate captions, correct the words, tune word-level timing, and turn plain subtitles into styled creator captions.",
		points: [
			{ title: "Generate automatically", description: "Start from automatic speech recognition instead of typing every line." },
			{ title: "Edit word timing", description: "Fine-tune timing where spoken words and captions need closer alignment." },
			{ title: "Style the result", description: "Apply animated presets, then adjust typography, position, color, and emphasis." },
		],
	},
	{
		slug: "auto-subtitle-generator",
		title: "Automatic subtitle generator",
		description: "Create editable automatic subtitles for video, then refine timing and export from your browser.",
		headline: "Automatic subtitles that remain yours to edit.",
		intro: "Generate a useful first pass, review the transcript, correct wording, and adjust caption timing before you export.",
		points: [
			{ title: "Editable output", description: "Automatic does not mean locked. Review and correct caption text in the editor." },
			{ title: "Timing controls", description: "Work with caption and word timing when the automatic result needs polish." },
			{ title: "Export choices", description: "Use supported full-video and subtitle export workflows when your project is ready." },
		],
	},
	{
		slug: "animated-caption-generator",
		title: "Animated caption generator",
		description: "Create animated captions with active-word highlighting and editable creator presets.",
		headline: "Animated captions without hiding the controls.",
		intro: "Choose a public Capinsta preset and keep control over type, color, layout, emphasis, background, and motion.",
		points: [
			{ title: "Active-word emphasis", description: "Draw attention to the word being spoken with configurable color, scale, and background." },
			{ title: "Real presets", description: "Start with the same canonical preset definitions available inside the editor." },
			{ title: "Preview before export", description: "Inspect the result in context and make style changes before rendering." },
		],
	},
];

export function getKeywordPage(slug: string) {
	return KEYWORD_PAGES.find((page) => page.slug === slug)!;
}

export const EDITOR_ONBOARDING_STORAGE_KEY = "capinsta-editor-onboarding:v1";

export type EditorHelpTopic =
	| "assets"
	| "preview"
	| "timeline"
	| "captions"
	| "properties"
	| "export";

export type EditorHelpContent = {
	title: string;
	description: string;
};

export const EDITOR_HELP_CONTENT: Record<EditorHelpTopic, EditorHelpContent> = {
	assets: {
		title: "Media library",
		description:
			"Import or manage the files used in your project. Drag assets onto the timeline to add them to your video.",
	},
	preview: {
		title: "Preview",
		description:
			"This is the live preview of your current edit. Use it to check video framing, playback, and caption positioning.",
	},
	timeline: {
		title: "Timeline",
		description:
			"The timeline controls when clips, audio, and captions appear. Drag items to reposition them and drag clip edges to trim duration.",
	},
	captions: {
		title: "Captions",
		description:
			"Generate subtitles from speech, edit the transcript, refine word timing, and customize the caption style.",
	},
	properties: {
		title: "Properties",
		description:
			"Select an item in the preview or timeline to edit its settings. Available controls change depending on what you selected.",
	},
	export: {
		title: "Export",
		description:
			"Render the final video using your current timeline and caption settings. Export subtitle files separately when supported.",
	},
};

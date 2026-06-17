import type { VideoFileData } from "./mediabunny";

export const getUnsupportedVideoDescription = ({
	codec,
}: {
	codec: VideoFileData["codec"];
}): string => {
	const codecLabel = codec ? codec.toUpperCase() : "this video codec";

	if (codec === "hevc") {
		return `${codecLabel} cannot be decoded in this browser, so this clip may not preview correctly. Convert it to H.264 MP4 or try importing it in Safari.`;
	}

	if (codec === "avc") {
		return "This H.264/AVC file cannot be decoded by the browser preview pipeline, so this clip may not preview correctly. Try re-exporting with a browser-compatible H.264 profile or a different MP4 encoder.";
	}

	return `${codecLabel} cannot be decoded in this browser, so this clip may not preview correctly. Convert it to H.264 MP4 and reimport it.`;
};

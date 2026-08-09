import { Composition, type CalculateMetadataFunction } from "remotion";
import { CapInstaComposition } from "./CapInstaComposition";
import { CapInstaOverlayComposition } from "./CapInstaOverlayComposition";
import { ALPHA_AUDIT_FULL_FRAME_ID, ALPHA_AUDIT_OVERLAY_ID, AlphaAuditComposition } from "./AlphaAuditComposition";
import {
	REMOTION_COMPOSITION_ID,
	REMOTION_OVERLAY_COMPOSITION_ID,
	metadataForProps,
	type CapInstaRemotionPropsV1,
	validateRemotionProps,
} from "./contracts";

const defaultProps: CapInstaRemotionPropsV1 = {
	version: 1,
	export: { width: 1080, height: 1920, fps: 30, quality: "standard", backgroundColor: "#000000" },
	media: { sources: [{ id: "source", url: "/remotion-fixtures/moving-source-30s.mp4", hasAudio: true, accessMode: "localized" }] },
	timeline: {
		edl: {
			schemaVersion: 1,
			clipProjectId: "remotion-default",
			projectRevision: 1,
			sourceMediaId: "source",
			sourceDurationMs: 30_000,
			outputDurationMs: 30_000,
			entries: [{ id: "edl-default", rangeId: "default", order: 0, sourceMediaId: "source", sourceStartMs: 0, sourceEndMs: 30_000, sourceDurationMs: 30_000, outputStartMs: 0, outputEndMs: 30_000, outputDurationMs: 30_000, playbackRate: 1, transitionIn: null, transitionOut: null, metadata: {} }],
			warnings: [],
			metadata: {},
		},
	},
};

const calculateMetadata: CalculateMetadataFunction<CapInstaRemotionPropsV1> = ({ props }) => {
	const validated = validateRemotionProps(props);
	return { ...metadataForProps(validated), props: validated };
};

export function RemotionRoot() {
	return (
		<>
		<Composition
			id={REMOTION_COMPOSITION_ID}
			component={CapInstaComposition}
			defaultProps={defaultProps}
			width={1080}
			height={1920}
			fps={30}
			durationInFrames={900}
			calculateMetadata={calculateMetadata}
		/>
		<Composition
			id={REMOTION_OVERLAY_COMPOSITION_ID}
			component={CapInstaOverlayComposition}
			defaultProps={defaultProps}
			width={1080}
			height={1920}
			fps={30}
			durationInFrames={900}
			calculateMetadata={calculateMetadata}
		/>
		<Composition id={ALPHA_AUDIT_OVERLAY_ID} component={AlphaAuditComposition} defaultProps={{ backgroundColor: null }} width={1080} height={1920} fps={30} durationInFrames={1} />
		<Composition id={ALPHA_AUDIT_FULL_FRAME_ID} component={AlphaAuditComposition} defaultProps={{ backgroundColor: "#335577" }} width={1080} height={1920} fps={30} durationInFrames={1} />
		</>
	);
}

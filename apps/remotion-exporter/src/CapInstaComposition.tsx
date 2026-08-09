import { AbsoluteFill } from "remotion";
import { CapInstaCaptionLayer } from "./CapInstaCaptionLayer";
import { CapInstaVideoTrack } from "./CapInstaVideoTrack";
import type { CapInstaRemotionPropsV1 } from "./contracts";
import { FontGate } from "./FontGate";

export function CapInstaComposition(props: CapInstaRemotionPropsV1) {
	return (
		<FontGate props={props}>
			<AbsoluteFill style={{ backgroundColor: props.export.backgroundColor }}>
				<CapInstaVideoTrack props={props} />
				<CapInstaCaptionLayer props={props} />
			</AbsoluteFill>
		</FontGate>
	);
}

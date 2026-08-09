import { AbsoluteFill } from "remotion";
import type { CapInstaRemotionPropsV1 } from "./contracts";
import { CapInstaCaptionLayer } from "./CapInstaCaptionLayer";

export function CapInstaOverlayComposition(props: CapInstaRemotionPropsV1) {
	return (
		<AbsoluteFill style={{ backgroundColor: "transparent" }}>
			<CapInstaCaptionLayer props={props} />
		</AbsoluteFill>
	);
}

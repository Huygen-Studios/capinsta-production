import { useEffect, useMemo, type ReactNode } from "react";
import { cancelRender, continueRender, delayRender } from "remotion";
import { ensureCapinstaFontLoaded } from "../../web/src/capinsta/fonts/captionFontRegistry";
import { resolveCapinstaClipStyle } from "../../web/src/capinsta/styles/styleMigration";
import type { CapInstaRemotionPropsV1 } from "./contracts";

export function FontGate({ props, children }: { props: CapInstaRemotionPropsV1; children: ReactNode }) {
	const handle = useMemo(() => delayRender("Loading bundled CapInsta caption fonts"), []);
	useEffect(() => {
		const document = props.captions?.document;
		const requests = new Map<string, { family: string; weight: number; style: "normal" | "italic" }>();
		for (const clip of document?.clips ?? []) {
			const style = resolveCapinstaClipStyle({ document: document!, clip });
			const weight = typeof style.text.fontWeight === "number" ? style.text.fontWeight : style.text.fontWeight === "bold" ? 700 : 400;
			for (const family of [style.text.fontFamily, style.lockup.bigFontFamily, style.lockup.smallFontFamily]) {
				for (const fontStyle of ["normal", "italic"] as const) requests.set(`${family}:${weight}:${fontStyle}`, { family, weight, style: fontStyle });
			}
		}
		Promise.all([...requests.values()].map((request) => ensureCapinstaFontLoaded({ ...request, strict: true })))
			.then(() => continueRender(handle))
			.catch((error) => cancelRender(error instanceof Error ? error : new Error(String(error))));
	}, [handle, props.captions?.document]);
	return children;
}

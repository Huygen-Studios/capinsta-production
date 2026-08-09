import { AbsoluteFill } from "remotion";

export const ALPHA_AUDIT_OVERLAY_ID = "CapInstaAlphaAuditOverlay";
export const ALPHA_AUDIT_FULL_FRAME_ID = "CapInstaAlphaAuditFullFrame";

export type AlphaAuditProps = { backgroundColor: string | null };

export function AlphaAuditComposition({ backgroundColor }: AlphaAuditProps) {
	return (
		<AbsoluteFill style={{ backgroundColor: backgroundColor ?? "transparent", fontFamily: "Arial, sans-serif" }}>
			<div style={{ position: "absolute", left: 120, top: 320, color: "rgba(255,255,255,0.5)", fontSize: 112, fontWeight: 800 }}>50% WHITE</div>
			<div style={{ position: "absolute", left: 140, top: 560, width: 800, height: 180, borderRadius: 90, background: "rgba(255,40,120,0.42)", boxShadow: "0 30px 55px rgba(10,20,80,0.55)" }} />
			<div style={{ position: "absolute", left: 180, top: 850, width: 720, height: 260, borderRadius: 42, background: "linear-gradient(90deg, rgba(0,220,255,0), rgba(0,220,255,0.85), rgba(150,80,255,0.18))" }} />
			<div style={{ position: "absolute", left: 340, top: 1260, width: 400, height: 180, borderRadius: 90, background: "rgba(255,220,40,0.72)", filter: "blur(18px)", boxShadow: "0 0 90px 35px rgba(60,150,255,0.6)" }} />
			<div style={{ position: "absolute", left: 120, top: 1580, color: "white", fontSize: 96, fontWeight: 900, textShadow: "0 0 24px rgba(80,180,255,0.9), 18px 22px 14px rgba(0,0,0,0.55)" }}>GLOW EDGE</div>
		</AbsoluteFill>
	);
}

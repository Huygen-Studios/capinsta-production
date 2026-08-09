import "opencut-wasm";

declare module "opencut-wasm" {
	export interface RustCaptionDocument {
		version: number;
		pages: Array<{ id: string; wordIds: string[]; startUs: number; endUs: number; displayTextOverride?: string; activeWordEffectsEnabled?: boolean }>;
		words: Array<{ id: string; [key: string]: unknown }>;
		[key: string]: unknown;
	}
}

import {
	type CapinstaMediaReferenceV1,
	validateCapinstaProjectConversionResultV1,
} from "@capinsta/transcript-contract";
import type { SerializedProject } from "@/services/storage/types";

export interface CapinstaConversionImportV1 {
	project: SerializedProject;
	mediaReference: CapinstaMediaReferenceV1;
}

/**
 * Validates Rust conversion output and exposes the existing serialized-project
 * boundary. This adapter performs no timing, trim, caption, or ID conversion.
 */
export function capinstaConversionResultToSerializedProject(
	value: unknown,
): CapinstaConversionImportV1 {
	const result = validateCapinstaProjectConversionResultV1(value);
	return {
		// The shared contract validator owns the complete serialized project shape.
		// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
		project: result.project as unknown as SerializedProject,
		mediaReference: result.mediaReference,
	};
}

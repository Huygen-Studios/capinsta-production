import { describe, expect, test } from "bun:test";
import fixture from "../../../../contracts/fixtures/capinsta-project-conversion-v1/valid/project-with-remapped-captions.json";
import { capinstaConversionResultToSerializedProject } from "./clipProjectConversion";

describe("ClipProject conversion compatibility", () => {
	test("accepts Rust output at the existing serialized-project boundary", () => {
		const { project, mediaReference } =
			capinstaConversionResultToSerializedProject(fixture.result);

		expect(project.version).toBe(35);
		expect(project.metadata.id).toBe("project_fixture");
		expect(project.metadata.duration).toBe(
			fixture.input.editDecisionList.outputDurationMs * 120,
		);
		expect(project.scenes[0]?.tracks.main.elements).toHaveLength(1);
		expect(project.capinstaCaptionDocuments).toHaveLength(1);
		expect(mediaReference.mediaId).toBe(
			fixture.input.clipProject.sourceMedia.mediaId,
		);
		expect(JSON.stringify(project)).not.toContain("portable/media_001");
	});
});

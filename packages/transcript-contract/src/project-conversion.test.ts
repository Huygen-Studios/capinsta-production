import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
	validateCapinstaProjectConversionResultV1,
	validateClipProjectConversionInputV1,
} from "./index";

const fixtureRoot = join(
	import.meta.dir,
	"..",
	"..",
	"..",
	"contracts",
	"fixtures",
	"capinsta-project-conversion-v1",
);

describe("Capinsta project conversion V1 fixtures", () => {
	for (const name of readdirSync(join(fixtureRoot, "valid")).sort()) {
		test(`accepts ${name}`, () => {
			const fixture = JSON.parse(
				readFileSync(join(fixtureRoot, "valid", name), "utf8"),
			) as { input: unknown; result: unknown };
			const input = validateClipProjectConversionInputV1(fixture.input);
			const result = validateCapinstaProjectConversionResultV1(fixture.result);
			expect(result.sourceClipProjectId).toBe(input.clipProject.clipProjectId);
			expect(result.sourceClipProjectRevision).toBe(input.clipProject.revision);
			expect(result.project.metadata.duration).toBe(
				input.editDecisionList.outputDurationMs * 120,
			);
		});
	}

	for (const name of readdirSync(join(fixtureRoot, "invalid")).sort()) {
		test(`rejects ${name}`, () => {
			const fixture = JSON.parse(
				readFileSync(join(fixtureRoot, "invalid", name), "utf8"),
			) as { input: unknown };
			expect(() =>
				validateClipProjectConversionInputV1(fixture.input),
			).toThrow();
		});
	}
});

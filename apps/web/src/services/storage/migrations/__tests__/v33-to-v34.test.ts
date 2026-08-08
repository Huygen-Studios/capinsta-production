import { describe, expect, test } from "bun:test";
import { getTemplateDefinition } from "@/templates";
import { transformProjectV33ToV34 } from "../transformers/v33-to-v34";

function projectWithElement({ element }: { element: Record<string, unknown> }) {
	return {
		id: "project-template-frame",
		version: 33,
		scenes: [
			{
				id: "scene",
				tracks: {
					main: { id: "main", type: "video", elements: [] },
					overlay: [{ id: "graphics", type: "graphic", elements: [element] }],
					audio: [],
				},
			},
		],
	};
}

describe("V33 to V34 migration", () => {
	test("moves v1 templates to transparent project-following frames", () => {
		const result = transformProjectV33ToV34({
			project: projectWithElement({
				element: {
					id: "template",
					type: "motion-template",
					templateId: "image-trail",
					templateVersion: 1,
					templateParams: {
						frameRatio: "1:1",
						background: "#101014",
						cardSize: 0.4,
					},
				},
			}),
		});
		const serialized = JSON.stringify(result.project);
		expect(result.project.version).toBe(34);
		expect(serialized).toContain('"templateVersion":2');
		expect(serialized).toContain('"frameRatio":"project"');
		expect(serialized).toContain('"backgroundEnabled":false');
		expect(serialized).toContain('"cardSize":0.4');
	});

	test("preserves explicit version 2 choices", () => {
		const definition = getTemplateDefinition({ templateId: "image-trail" });
		const result = transformProjectV33ToV34({
			project: projectWithElement({
				element: {
					id: "template",
					type: "motion-template",
					templateId: definition.id,
					templateVersion: definition.version,
					templateParams: {
						frameRatio: "4:5",
						backgroundEnabled: true,
						background: "#123456",
					},
				},
			}),
		});
		const serialized = JSON.stringify(result.project);
		expect(serialized).toContain('"frameRatio":"4:5"');
		expect(serialized).toContain('"backgroundEnabled":true');
		expect(serialized).toContain('"background":"#123456"');
	});
});

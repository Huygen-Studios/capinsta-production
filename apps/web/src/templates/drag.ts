import type { MotionTemplateDefinition, TemplateFrameRatio } from "@/templates";
import type { MotionTemplateDragData } from "@/timeline/drag";

export function createMotionTemplateDragData({
	definition,
	frameRatio,
}: {
	definition: MotionTemplateDefinition;
	frameRatio?: TemplateFrameRatio;
}): MotionTemplateDragData {
	return {
		type: "motion-template",
		id: definition.id,
		name: definition.name,
		templateId: definition.id,
		templateVersion: definition.version,
		...(frameRatio ? { frameRatio } : {}),
	};
}

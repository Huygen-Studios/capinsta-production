import type { MotionTemplateDefinition } from "@/templates";
import type { MotionTemplateDragData } from "@/timeline/drag";

export function createMotionTemplateDragData({
	definition,
}: {
	definition: MotionTemplateDefinition;
}): MotionTemplateDragData {
	return {
		type: "motion-template",
		id: definition.id,
		name: definition.name,
		templateId: definition.id,
		templateVersion: definition.version,
	};
}

import { effectsRegistry } from "@/effects/registry";
import { paperFoldEffectDefinition } from "./paper-fold";

let registered = false;

export function registerDefaultEffects(): void {
	if (registered) return;
	effectsRegistry.register({
		key: paperFoldEffectDefinition.type,
		definition: paperFoldEffectDefinition,
	});
	registered = true;
}

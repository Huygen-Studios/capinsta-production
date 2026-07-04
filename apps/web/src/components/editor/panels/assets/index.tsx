"use client";

import { Separator } from "@/components/ui/separator";
import {
	type Tab,
	useAssetsPanelStore,
} from "@/components/editor/panels/assets/assets-panel-store";
import { TabBar } from "./tabbar";
import { Captions } from "@/subtitles/components/assets-view";
import { MediaView } from "./views/assets";
import { SettingsView } from "./views/settings";
import { TextView } from "@/text/components/assets-view";
import { EffectsView } from "@/effects/components/assets-view";
import { EditorHelpButton } from "@/components/editor/editor-help-button";
import { EDITOR_HELP_CONTENT } from "@/components/editor/editor-help-content";

function FuturePanel({ title }: { title: string }) {
	return <div className="text-muted-foreground p-4">{title}</div>;
}

export function AssetsPanel() {
	const { activeTab } = useAssetsPanelStore();

	const viewMap: Record<Tab, React.ReactNode> = {
		media: <MediaView />,
		text: <TextView />,
		effects: <EffectsView />,
		transitions: <FuturePanel title="Transitions" />,
		captions: <Captions />,
		adjustment: <FuturePanel title="Adjustments" />,
		settings: <SettingsView />,
	};

	return (
		<div
			className="panel editor-panel relative flex h-full overflow-hidden"
			data-tour="assets-panel"
		>
			<div className="absolute right-2 top-2 z-20">
				<EditorHelpButton
					title={EDITOR_HELP_CONTENT.assets.title}
					description={EDITOR_HELP_CONTENT.assets.description}
				/>
			</div>
			<TabBar />
			<Separator orientation="vertical" />
			<div className="flex-1 overflow-hidden">{viewMap[activeTab]}</div>
		</div>
	);
}

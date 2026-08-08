"use client";

import React, { useState } from "react";
import { Group, Panel, Separator, type Layout } from "react-resizable-panels";
import CaptionFirstLeftPanel from "./CaptionFirstLeftPanel";
import MobileEditorShell from "./MobileEditorShell";
import ProgramMonitor from "./ProgramMonitor";
import RightPanel from "./RightPanel";
import Timeline from "./Timeline";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { usePanelLayoutPersistence } from "@/hooks/usePanelLayoutPersistence";

type TabletSidePanel = "captions" | "style";

function ResizeHandle({ direction }: { direction: "horizontal" | "vertical" }) {
  return <Separator className={`resize-handle ${direction === "horizontal" ? "resize-handle-x" : "resize-handle-y"}`} />;
}

function valuesFromLayout(layout: Layout, ids: string[]) {
  const values = ids.map((id) => Number(layout[id]));
  return values.every((value) => Number.isFinite(value) && value > 0) ? values : null;
}

function DesktopResizableLayout() {
  const { layouts, saveLayout, layoutVersion } = usePanelLayoutPersistence();
  const saveVertical = (layout: Layout) => {
    const values = valuesFromLayout(layout, ["top", "timeline"]);
    if (values) saveLayout("vertical", values);
  };
  const saveHorizontal = (layout: Layout) => {
    const values = valuesFromLayout(layout, ["left", "program", "right"]);
    if (values) saveLayout("horizontal", values);
  };

  return (
    <main className="editor-workspace editor-workspace-desktop">
      <Group key={`desktop-layout-${layoutVersion}`} orientation="vertical" onLayoutChanged={saveVertical}>
        <Panel id="top" defaultSize={`${layouts.vertical[0]}%`} minSize="55%">
          <Group orientation="horizontal" onLayoutChanged={saveHorizontal}>
            <Panel id="left" defaultSize={`${layouts.horizontal[0]}%`} minSize="280px" maxSize="520px">
              <CaptionFirstLeftPanel />
            </Panel>
            <ResizeHandle direction="horizontal" />
            <Panel id="program" defaultSize={`${layouts.horizontal[1]}%`} minSize="320px">
              <ProgramMonitor />
            </Panel>
            <ResizeHandle direction="horizontal" />
            <Panel id="right" defaultSize={`${layouts.horizontal[2]}%`} minSize="280px" maxSize="520px">
              <RightPanel />
            </Panel>
          </Group>
        </Panel>
        <ResizeHandle direction="vertical" />
        <Panel id="timeline" defaultSize={`${layouts.vertical[1]}%`} minSize="160px" maxSize="45%">
          <Timeline />
        </Panel>
      </Group>
    </main>
  );
}

function TabletResizableLayout() {
  const { layouts, saveLayout, layoutVersion } = usePanelLayoutPersistence();
  const [sidePanel, setSidePanel] = useState<TabletSidePanel>("captions");
  const saveVertical = (layout: Layout) => {
    const values = valuesFromLayout(layout, ["top", "timeline"]);
    if (values) saveLayout("tabletVertical", values);
  };
  const saveHorizontal = (layout: Layout) => {
    const values = valuesFromLayout(layout, ["program", "side"]);
    if (values) saveLayout("tabletHorizontal", values);
  };

  return (
    <main className="editor-workspace editor-workspace-tablet">
      <Group key={`tablet-layout-${layoutVersion}`} orientation="vertical" onLayoutChanged={saveVertical}>
        <Panel id="top" defaultSize={`${layouts.tabletVertical[0]}%`} minSize="52%">
          <Group orientation="horizontal" onLayoutChanged={saveHorizontal}>
            <Panel id="program" defaultSize={`${layouts.tabletHorizontal[0]}%`} minSize="320px">
              <ProgramMonitor />
            </Panel>
            <ResizeHandle direction="horizontal" />
            <Panel id="side" defaultSize={`${layouts.tabletHorizontal[1]}%`} minSize="280px" maxSize="520px">
              <div className="panel flex h-full flex-col">
                <div className="panel-header gap-1">
                  <button className={`panel-header-tab ${sidePanel === "captions" ? "active" : ""}`} onClick={() => setSidePanel("captions")}>
                    Captions
                  </button>
                  <button className={`panel-header-tab ${sidePanel === "style" ? "active" : ""}`} onClick={() => setSidePanel("style")}>
                    Style
                  </button>
                </div>
                <div className="min-h-0 flex-1">{sidePanel === "captions" ? <CaptionFirstLeftPanel /> : <RightPanel />}</div>
              </div>
            </Panel>
          </Group>
        </Panel>
        <ResizeHandle direction="vertical" />
        <Panel id="timeline" defaultSize={`${layouts.tabletVertical[1]}%`} minSize="160px" maxSize="45%">
          <Timeline />
        </Panel>
      </Group>
    </main>
  );
}

export default function EditorWorkspaceShell() {
  const isMobile = useMediaQuery("(max-width: 767px)");
  const isTablet = useMediaQuery("(min-width: 768px) and (max-width: 1199px)");

  if (isMobile) return <MobileEditorShell />;
  if (isTablet) return <TabletResizableLayout />;
  return <DesktopResizableLayout />;
}

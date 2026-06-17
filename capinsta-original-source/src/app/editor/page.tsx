import type { Metadata } from "next";
import EditorApp from "@/components/editor/EditorApp";
import { createMetadata } from "@/config/site";

export const metadata: Metadata = createMetadata({
  title: "Editor - Huygen Caps",
  description: "Private Huygen Caps caption editor workspace.",
  path: "/editor",
  noIndex: true,
});

export default function EditorPage() {
  return <EditorApp />;
}

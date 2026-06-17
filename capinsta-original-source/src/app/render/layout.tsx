import type { Metadata } from "next";
import { createMetadata } from "@/config/site";

export const metadata: Metadata = createMetadata({
  title: "Render Frame - Huygen Caps",
  description: "Private render frame for Huygen Caps exports.",
  path: "/render",
  noIndex: true,
});

export default function RenderLayout({ children }: { children: React.ReactNode }) {
  return children;
}

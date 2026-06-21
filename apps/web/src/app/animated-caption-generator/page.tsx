import type { Metadata } from "next";
import { KeywordPage } from "@/components/marketing/keyword-page";
import { getKeywordPage } from "@/marketing/keyword-pages";
const page = getKeywordPage("animated-caption-generator");
export const metadata: Metadata = { title: page.title, description: page.description, alternates: { canonical: "/animated-caption-generator" } };
export default function Page() { return <KeywordPage page={page} />; }

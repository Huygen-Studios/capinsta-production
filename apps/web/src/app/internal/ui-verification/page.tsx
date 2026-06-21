import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { NumberFieldVerification } from "./verification-client";

export const metadata: Metadata = {
	title: "UI verification",
	robots: { index: false, follow: false, nocache: true, noarchive: true },
};

export default function UiVerificationPage() {
	if (process.env.NODE_ENV === "production") notFound();
	return <NumberFieldVerification />;
}

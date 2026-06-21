import { ThemeProvider } from "next-themes";
import Script from "next/script";
import type { Viewport } from "next";
import "./globals.css";
import { Toaster } from "../components/ui/sonner";
import { ChangelogNotification } from "@/changelog/components/changelog-notification";
import { TooltipProvider } from "../components/ui/tooltip";
import { baseMetaData, viewportTheme } from "./metadata";
import { BotIdClient } from "botid/client";
import { webEnv } from "@/env/web";
import { Inter, Urbanist } from "next/font/google";
import { DevToolsLoader } from "./dev-tools-loader";
import { CookieConsentBanner } from "@/components/cookie-consent";
import { RenderRouteExclusions } from "@/components/render-route-exclusions";
import { GoogleAnalytics } from "@next/third-parties/google";

const siteFont = Inter({ subsets: ["latin"], variable: "--font-inter" });
const displayFont = Urbanist({
	subsets: ["latin"],
	variable: "--font-urbanist",
	weight: ["500", "600", "700", "800", "900"],
});

export const metadata = baseMetaData;
export const viewport: Viewport = viewportTheme;

const protectedRoutes = [
	{
		path: "/none",
		method: "GET",
	},
];

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head>
				<BotIdClient protect={protectedRoutes} />
			</head>
			<body
				className={`${siteFont.variable} ${displayFont.variable} font-sans antialiased`}
			>
				{webEnv.NEXT_PUBLIC_GA_ID && (
					<GoogleAnalytics gaId={webEnv.NEXT_PUBLIC_GA_ID} />
				)}
				<ThemeProvider
					attribute="class"
					defaultTheme="system"
					enableSystem
					enableColorScheme
					disableTransitionOnChange={true}
				>
					<TooltipProvider>
						{/* Dev-only tools (React Scan) — client-gated to NEVER load on /render.
						    Previously this was a beforeInteractive <Script> in <head> that
						    always loaded in dev, including for the headless export page,
						    injecting purple overlay boxes into export screenshots. */}
					<DevToolsLoader />
						<RenderRouteExclusions>
							<Toaster />
							<Script
								src="https://cdn.databuddy.cc/databuddy.js"
								strategy="afterInteractive"
								async
								data-client-id="UP-Wcoy5arxFeK7oyjMMZ"
								data-disabled={webEnv.NODE_ENV === "development"}
								data-track-attributes={false}
								data-track-errors={true}
								data-track-outgoing-links={false}
								data-track-web-vitals={false}
								data-track-sessions={false}
							/>
							<CookieConsentBanner />
						</RenderRouteExclusions>
						{children}
					</TooltipProvider>
				</ThemeProvider>
			</body>
		</html>
	);
}

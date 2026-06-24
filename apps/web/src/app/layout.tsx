import { ThemeProvider } from "next-themes";
import Script from "next/script";
import type { Viewport } from "next";
import "./globals.css";
import { Toaster } from "../components/ui/sonner";
import { TooltipProvider } from "../components/ui/tooltip";
import { baseMetaData, viewportTheme } from "./metadata";
import { webEnv } from "@/env/web";
import { Archivo_Black, Space_Grotesk } from "next/font/google";
import { DevToolsLoader } from "./dev-tools-loader";
import { RouteCookieConsent } from "@/components/route-cookie-consent";
import { RenderRouteExclusions } from "@/components/render-route-exclusions";
import { GoogleAnalyticsProvider } from "@/components/analytics/google-analytics-provider";

const siteFont = Space_Grotesk({
	subsets: ["latin"],
	variable: "--font-space-grotesk",
	weight: ["400", "500", "600", "700"],
});
const displayFont = Archivo_Black({
	subsets: ["latin"],
	variable: "--font-archivo-black",
	weight: "400",
});

export const metadata = baseMetaData;
export const viewport: Viewport = viewportTheme;

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en" suppressHydrationWarning>
			<head />
			<body
				className={`${siteFont.variable} ${displayFont.variable} font-sans antialiased`}
			>
				<GoogleAnalyticsProvider />
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
							<RouteCookieConsent />
						</RenderRouteExclusions>
						{children}
					</TooltipProvider>
				</ThemeProvider>
			</body>
		</html>
	);
}

import { ThemeProvider } from "next-themes";
import Script from "next/script";
import "./globals.css";
import { Toaster } from "../components/ui/sonner";
import { ChangelogNotification } from "@/changelog/components/changelog-notification";
import { TooltipProvider } from "../components/ui/tooltip";
import { baseMetaData } from "./metadata";
import { BotIdClient } from "botid/client";
import { webEnv } from "@/env/web";
import { Inter } from "next/font/google";
import { DevToolsLoader } from "./dev-tools-loader";

const siteFont = Inter({ subsets: ["latin"] });

export const metadata = baseMetaData;

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
			<body className={`${siteFont.className} font-sans antialiased`}>
				<ThemeProvider
					attribute="class"
					defaultTheme="system"
					disableTransitionOnChange={true}
				>
					<TooltipProvider>
						{/* Dev-only tools (React Scan) — client-gated to NEVER load on /render.
						    Previously this was a beforeInteractive <Script> in <head> that
						    always loaded in dev, including for the headless export page,
						    injecting purple overlay boxes into export screenshots. */}
						<DevToolsLoader />
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
						{children}
					</TooltipProvider>
				</ThemeProvider>
			</body>
		</html>
	);
}

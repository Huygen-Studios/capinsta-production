"use client";

import { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/site/brand";

/** Augment Window so we can attach a consent-reopen helper safely. */
declare global {
	interface Window {
		capinstaReopenConsent?: () => void;
	}
}

/**
 * Cookie consent categories.
 *
 * `necessary` is always granted and cannot be withdrawn — the editor does not
 * work without local storage for preferences/session. `analytics` and
 * `advertising` default to denied and must be explicitly granted by the user.
 */
export type ConsentCategory = "necessary" | "analytics" | "advertising";

export type ConsentState = {
	necessary: true;
	analytics: boolean;
	advertising: boolean;
	/** ISO timestamp of the most recent decision, used to expire stale consent. */
	updatedAt: string | null;
};

const STORAGE_KEY = "capinsta-cookie-consent";
/** Re-ask after 12 months. */
const CONSENT_TTL_MS = 1000 * 60 * 60 * 24 * 365;

const DEFAULT_DENIED: ConsentState = {
	necessary: true,
	analytics: false,
	advertising: false,
	updatedAt: null,
};

function readStoredConsent(): ConsentState | null {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as Partial<ConsentState>;
		if (typeof parsed.analytics !== "boolean") return null;
		if (!parsed.updatedAt) return null;
		const age = Date.now() - new Date(parsed.updatedAt).getTime();
		if (Number.isNaN(age) || age > CONSENT_TTL_MS) return null;
		return {
			necessary: true,
			analytics: parsed.analytics,
			advertising: !!parsed.advertising,
			updatedAt: parsed.updatedAt,
		};
	} catch {
		return null;
	}
}

function writeConsent(state: ConsentState) {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	} catch {
		// Storage unavailable (private mode) — consent stays in-memory only.
	}
}

/** Notify the rest of the app / ad scripts that consent changed. */
function broadcast(state: ConsentState) {
	window.dispatchEvent(
		new CustomEvent("capinsta:consent-change", { detail: state }),
	);
}

/**
 * Read consent synchronously. Used by ad/analytics loaders to decide whether to
 * fire before React hydrates.
 */
export function readConsent(): ConsentState {
	if (typeof window === "undefined") return DEFAULT_DENIED;
	return readStoredConsent() ?? DEFAULT_DENIED;
}

let hydratedRef: { current: ConsentState } = { current: DEFAULT_DENIED };

export function useCookieConsent() {
	const [state, setState] = useState<ConsentState>(hydratedRef.current);
	const [hydrated, setHydrated] = useState(false);

	useEffect(() => {
		const stored = readStoredConsent();
		const next = stored ?? DEFAULT_DENIED;
		hydratedRef.current = next;
		setState(next);
		setHydrated(true);

		const handler = (e: Event) => {
			const detail = (e as CustomEvent<ConsentState>).detail;
			hydratedRef.current = detail;
			setState(detail);
		};
		window.addEventListener("capinsta:consent-change", handler);
		return () => window.removeEventListener("capinsta:consent-change", handler);
	}, []);

	const decide = useCallback(
		(partial: Partial<Pick<ConsentState, "analytics" | "advertising">>) => {
			const next: ConsentState = {
				necessary: true,
				analytics: !!partial.analytics,
				advertising: !!partial.advertising,
				updatedAt: new Date().toISOString(),
			};
			writeConsent(next);
			hydratedRef.current = next;
			broadcast(next);
		},
		[],
	);

	const acceptAll = useCallback(
		() => decide({ analytics: true, advertising: true }),
		[decide],
	);
	const rejectAll = useCallback(
		() => decide({ analytics: false, advertising: false }),
		[decide],
	);

	return { state, hydrated, acceptAll, rejectAll, decide };
}

/** Whether the banner should be shown (no stored decision yet). */
export function shouldShowBanner(): boolean {
	if (typeof window === "undefined") return false;
	return readStoredConsent() === null;
}

/**
 * Mount once near the root. Renders the consent banner only when the user has
 * not yet decided. Exposes a global to reopen preferences.
 */
export function CookieConsentBanner() {
	const { state, hydrated, acceptAll, rejectAll } = useCookieConsent();
	const [forceShow, setForceShow] = useState(false);

	// Derive banner visibility: show when no decision stored OR user explicitly
	// reopened preferences. Avoids setState-in-effect for the stored-decision path.
	const showBanner = hydrated && (state.updatedAt === null || forceShow);

	useEffect(() => {
		const reopen = () => setForceShow(true);
		window.addEventListener("capinsta:reopen-consent", reopen);
		// Also expose a global for easy linking.
		window.capinstaReopenConsent = reopen;
		return () => {
			window.removeEventListener("capinsta:reopen-consent", reopen);
			window.capinstaReopenConsent = undefined;
		};
	}, []);

	if (!showBanner) return null;

	return (
		<div
			role="dialog"
			aria-label="Cookie preferences"
			aria-live="polite"
			className="fixed inset-x-0 bottom-0 z-[100] p-4"
		>
			<div className="mx-auto max-w-3xl rounded-2xl border-2 border-ink bg-background p-6 shadow-brut-lg">
				<div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
					<div className="text-sm text-muted-foreground">
						<p className="font-semibold text-foreground">
							We value your privacy
						</p>
						<p className="mt-1">
							We use necessary storage to run the editor. With your permission, we
							also use analytics and advertising cookies. You can change your choice
							at any time. Read our{" "}
							<a href="/cookies" className="text-brand underline dark:text-violet-300">
								Cookie Policy
							</a>
							.
						</p>
					</div>
					<div className="flex shrink-0 flex-col gap-2 sm:flex-row">
						<Button
							variant="outline"
							size="sm"
							onClick={rejectAll}
							className="font-medium"
						>
							Reject non-essential
						</Button>
						<Button
							size="sm"
							onClick={acceptAll}
							className="bg-brand text-brand-foreground font-semibold hover:bg-brand-strong"
						>
							Accept all
							</Button>
						</div>
					</div>
				</div>
			</div>
		);
}

/**
 * Small footer link that reopens the consent banner. Mounted in the footer so
 * users can revise their choice at any time.
 */
export function CookiePreferencesButton() {
	const reopen = useCallback(() => {
		window.dispatchEvent(new CustomEvent("capinsta:reopen-consent"));
	}, []);

	return (
		<button
			type="button"
			onClick={reopen}
			className="text-muted-foreground hover:text-foreground text-sm transition-colors"
		>
			Cookie preferences
		</button>
	);
}

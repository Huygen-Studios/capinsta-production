import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BRAND, ROUTES } from "@/site/brand";
import {
	Mic01Icon,
	MagicWand01Icon,
	PlayCircleIcon,
	Download01Icon,
	Clock01Icon,
	Shield02Icon,
	Video01Icon,
	SubtitleIcon,
	BrushIcon,
	Download04Icon,
	CheckmarkCircle02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";

/* ------------------------------------------------------------------ */
/*  Features                                                          */
/* ------------------------------------------------------------------ */

const features = [
	{
		icon: Mic01Icon,
		title: "Automatic caption generation",
		description:
			"Upload a video and generate captions with accurate word-level timing. Powered by AI speech recognition.",
	},
	{
		icon: MagicWand01Icon,
		title: "Active-word highlighting",
		description:
			"See each word light up as it's spoken. Apply styled caption presets with bold active-word emphasis.",
	},
	{
		icon: PlayCircleIcon,
		title: "Real-time preview",
		description:
			"Watch your captioned video play back in the browser. Adjust timing, wording, and style before exporting.",
	},
	{
		icon: Download01Icon,
		title: "Full video or captions-only export",
		description:
			"Export the complete captioned video, or download just the captions as SRT or VTT for use in any editor.",
	},
	{
		icon: Clock01Icon,
		title: "Word-level timing",
		description:
			"Fine-tune when each caption appears and disappears. Adjust individual word timing for perfect sync.",
	},
	{
		icon: Shield02Icon,
		title: "Temporary storage for privacy",
		description:
			"Your uploaded video and generated captions are held only during editing. They're automatically deleted after inactivity.",
	},
];

export function FeaturesSection() {
	return (
		<section id="features" className="scroll-mt-20">
			<div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
				<div className="text-center mb-16">
					<h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
						Everything you need to caption a video
					</h2>
					<p className="mt-4 max-w-2xl mx-auto text-lg text-muted-foreground">
						{BRAND.productName} handles the full caption workflow — from upload to export — in one browser tab.
					</p>
				</div>

				<div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
					{features.map((f) => (
						<div
							key={f.title}
							className="group rounded-2xl border-2 border-ink bg-background p-6 shadow-brut transition-transform hover:-translate-y-0.5 hover:shadow-brut-lg"
						>
							<div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-brand/10 text-brand">
								<HugeiconsIcon icon={f.icon} className="size-6" />
							</div>
							<h3 className="text-lg font-semibold">{f.title}</h3>
							<p className="mt-2 text-muted-foreground text-sm leading-relaxed">
								{f.description}
							</p>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}

/* ------------------------------------------------------------------ */
/*  How It Works                                                      */
/* ------------------------------------------------------------------ */

const steps = [
	{
		icon: Video01Icon,
		step: "1",
		title: "Import your video",
		description:
			"Drag and drop a video file into the editor. MP4, WebM, and other common formats are supported.",
	},
	{
		icon: SubtitleIcon,
		step: "2",
		title: "Generate captions",
		description:
			"Click generate and let AI create accurate, word-timed captions. Supports English, Hinglish, Telgish, and mixed Indian-language workflows.",
	},
	{
		icon: BrushIcon,
		step: "3",
		title: "Style and fine-tune",
		description:
			"Choose a caption preset, adjust active-word highlighting, tweak timing, and preview the result in real time.",
	},
	{
		icon: Download04Icon,
		step: "4",
		title: "Export your result",
		description:
			"Download the full captioned video or export just the subtitles as SRT or VTT. Your export is ready to share.",
	},
];

export function HowItWorksSection() {
	return (
		<section id="how-it-works" className="scroll-mt-20 bg-muted/50">
			<div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
				<div className="text-center mb-16">
					<h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
						How it works
					</h2>
					<p className="mt-4 max-w-2xl mx-auto text-lg text-muted-foreground">
						Four steps from raw video to polished, captioned clip.
					</p>
				</div>

				<div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
					{steps.map((s, i) => (
						<div key={s.step} className="relative flex flex-col items-start">
							<span className="mb-4 flex h-10 w-10 items-center justify-center rounded-full border-2 border-ink bg-brand text-brand-foreground text-sm font-bold">
								{s.step}
							</span>
							<h3 className="text-lg font-semibold">{s.title}</h3>
							<p className="mt-2 text-muted-foreground text-sm leading-relaxed">
								{s.description}
							</p>
							{i < steps.length - 1 && (
								<span className="hidden lg:block absolute top-5 left-[calc(100%+0.5rem)] text-ink text-2xl font-bold">
									→
								</span>
							)}
						</div>
					))}
				</div>
			</div>
		</section>
	);
}

/* ------------------------------------------------------------------ */
/*  Caption Workflows & Styles                                       */
/* ------------------------------------------------------------------ */

export function CaptionWorkflowsSection() {
	return (
		<section>
			<div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
				<div className="grid grid-cols-1 gap-16 lg:grid-cols-2 lg:items-center">
					<div>
						<h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
							Built for real caption workflows
						</h2>
						<p className="mt-4 text-muted-foreground text-lg leading-relaxed">
							Whether you&apos;re captioning English YouTube videos, Hinglish reels, or Telgish
							shorts, {BRAND.productName} handles mixed-language content that most tools
							cannot.
						</p>
						<ul className="mt-8 space-y-4">
							{[
								"English — clean, accurate, standard captions",
								"Hinglish — Hindi-English mixed speech, correctly transcribed",
								"Telgish — Telugu-English mixed speech support",
								"Auto-detect mixed Indian-language mode",
								"Word-level timing preserves language switching",
							].map((item) => (
								<li key={item} className="flex items-start gap-3">
									<HugeiconsIcon icon={CheckmarkCircle02Icon} className="mt-0.5 size-5 shrink-0 text-brand" />
									<span className="text-muted-foreground text-sm">{item}</span>
								</li>
							))}
						</ul>
					</div>
					<div className="flex items-center justify-center">
						<div className="rounded-2xl border-2 border-ink bg-background p-8 shadow-brut-lg">
							<div className="space-y-3 text-center">
								<p className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
									Preview
								</p>
								<p className="text-xl font-bold">
									<span className="text-muted-foreground">So </span>
									<span className="bg-brand/20 px-1 rounded font-extrabold text-brand">
										basically
									</span>
									<span className="text-muted-foreground"> main </span>
									<span className="bg-brand/20 px-1 rounded font-extrabold text-brand">
										yeh
									</span>
									<span className="text-muted-foreground"> hai ki </span>
									<span className="bg-brand/20 px-1 rounded font-extrabold text-brand">
										captioning
									</span>
								</p>
								<p className="text-xs text-muted-foreground mt-2">Active-word highlighting on mixed-language Hinglish</p>
							</div>
						</div>
					</div>
				</div>
			</div>
		</section>
	);
}

/* ------------------------------------------------------------------ */
/*  Editing & Export                                                  */
/* ------------------------------------------------------------------ */

export function EditingExportSection() {
	return (
		<section className="bg-muted/50">
			<div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
				<div className="text-center mb-16">
					<h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
						Edit with precision, export with confidence
					</h2>
				</div>
				<div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
					{[
						{
							title: "Full video export",
							desc: "Download a complete captioned video with your styled subtitles burned in. Ready to upload to YouTube, Instagram, or any platform.",
						},
						{
							title: "Captions-only export",
							desc: "Export just the subtitle file as SRT or VTT. Use it in Premiere, DaVinci Resolve, CapCut, or any editor that supports sidecar subtitles.",
						},
						{
							title: "Styled caption presets",
							desc: "Choose from ready-made caption styles — bold text, boxed backgrounds, karaoke-style highlighting, and more. Apply with a single click.",
						},
					].map((item) => (
						<div
							key={item.title}
							className="rounded-2xl border-2 border-ink bg-background p-6 shadow-brut"
						>
							<h3 className="text-lg font-semibold">{item.title}</h3>
							<p className="mt-3 text-muted-foreground text-sm leading-relaxed">
								{item.desc}
							</p>
						</div>
					))}
				</div>
			</div>
		</section>
	);
}

/* ------------------------------------------------------------------ */
/*  Privacy & Temporary Storage                                      */
/* ------------------------------------------------------------------ */

export function PrivacySection() {
	return (
		<section>
			<div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
				<div className="mx-auto max-w-3xl text-center">
					<div className="mb-6 inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-brand/10 text-brand">
						<HugeiconsIcon icon={Shield02Icon} className="size-8" />
					</div>
					<h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
						Your videos don&apos;t live on our servers
					</h2>
					<p className="mt-6 text-lg text-muted-foreground leading-relaxed">
						{BRAND.productName} holds your uploaded video and generated captions only while you
						are actively editing. After a period of inactivity, everything is automatically
						deleted — the video, captions, transcripts, and exports. We don&apos;t keep your media
						longer than necessary.
					</p>
					<p className="mt-4 text-lg text-muted-foreground leading-relaxed">
						Remember to download your export before leaving the editor.
					</p>
				</div>
			</div>
		</section>
	);
}

/* ------------------------------------------------------------------ */
/*  Why Free                                                          */
/* ------------------------------------------------------------------ */

export function WhyFreeSection() {
	return (
		<section className="border-t-2 border-ink bg-brand text-brand-foreground">
			<div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
				<div className="mx-auto max-w-3xl text-center">
					<h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
						Why is {BRAND.productName} free?
					</h2>
					<p className="mt-6 text-lg leading-relaxed opacity-90">
						{BRAND.productName} is built and maintained by {BRAND.parentCompany}.
						We believe accessible captioning should not require a paid subscription.
						The service is free to use today, supported by non-intrusive advertising
						that never interferes with the editor or your exports.
					</p>
				</div>
			</div>
		</section>
	);
}

/* ------------------------------------------------------------------ */
/*  FAQ (landing page teaser — full FAQ on /faq)                      */
/* ------------------------------------------------------------------ */

const faqItems = [
	{
		q: "Is Capinsta really free?",
		a: "Yes. You can upload a video, generate captions, style them, and export without creating an account or paying anything.",
	},
	{
		q: "What languages are supported?",
		a: "English, Hinglish (Hindi-English mixed), Telgish (Telugu-English mixed), and auto-detect mode for mixed Indian-language content.",
	},
	{
		q: "What file formats can I export?",
		a: "Full captioned video (MP4) or captions-only (SRT and VTT subtitle files).",
	},
	{
		q: "Is my video stored permanently?",
		a: "No. Your video, captions, and exports are held only during your editing session. They are automatically deleted after a period of inactivity.",
	},
	{
		q: "Do I need to create an account?",
		a: "No account is required. Just open Capinsta, upload your video, and start captioning.",
	},
];

export function FaqSection() {
	return (
		<section id="faq" className="scroll-mt-20 bg-muted/50">
			<div className="mx-auto max-w-3xl px-4 py-24 sm:px-6 lg:px-8">
				<div className="text-center mb-16">
					<h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
						Frequently asked questions
					</h2>
				</div>
				<dl className="space-y-6">
					{faqItems.map((item) => (
						<div key={item.q} className="rounded-2xl border-2 border-ink bg-background p-6">
							<dt className="text-base font-semibold">{item.q}</dt>
							<dd className="mt-2 text-muted-foreground text-sm leading-relaxed">
								{item.a}
							</dd>
						</div>
					))}
				</dl>
			</div>
		</section>
	);
}

/* ------------------------------------------------------------------ */
/*  Final CTA                                                         */
/* ------------------------------------------------------------------ */

export function FinalCtaSection() {
	return (
			<section>
				<div className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
					<div className="rounded-2xl border-2 border-ink bg-background p-12 shadow-brut-lg text-center sm:p-16">
						<h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
							Ready to caption your next video?
						</h2>
						<p className="mt-4 max-w-xl mx-auto text-lg text-muted-foreground">
							No sign-up, no watermark, no cost. Open Capinsta and create
							accurate, animated captions in your browser.
						</p>
						<Link href={ROUTES.projects}>
							<Button
								size="lg"
								className="mt-8 shadow-brut bg-brand text-brand-foreground text-base font-bold px-8 py-6 hover:bg-brand-strong transition-colors"
							>
								Start Captioning
								<ArrowRight className="ml-2 size-5" />
							</Button>
						</Link>
					</div>
				</div>
			</section>
		);
}

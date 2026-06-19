"use client";

import { ArrowRightIcon } from "lucide-react";
import { useState } from "react";
import { BRAND, ROUTES } from "@/site/brand";
import { useLocalStorage } from "@/services/storage/use-local-storage";
import { Button } from "../ui/button";
import { Dialog, DialogBody, DialogContent, DialogTitle } from "../ui/dialog";

export function Onboarding() {
	const [step, setStep] = useState(0);
	const [hasSeenOnboarding, setHasSeenOnboarding] = useLocalStorage({
		key: "hasSeenOnboarding",
		defaultValue: false,
	});

	const isOpen = !hasSeenOnboarding;

	const handleNext = () => {
		setStep(step + 1);
	};

	const handleClose = () => {
		setHasSeenOnboarding({ value: true });
	};

	const getStepTitle = () => {
		switch (step) {
			case 0:
				return `Welcome to ${BRAND.productName}`;
			case 1:
				return "How it works";
			case 2:
				return "Ready to caption";
			default:
				return BRAND.productName;
		}
	};

	const renderStepContent = () => {
		switch (step) {
			case 0:
				return (
					<div className="space-y-5">
						<div className="space-y-3">
							<Title title={`Welcome to ${BRAND.productName}`} />
							<Description
								description={`${BRAND.productName} lets you generate accurate captions, style them with presets, and export captioned videos — all in your browser.`}
							/>
						</div>
						<NextButton onClick={handleNext}>Next</NextButton>
					</div>
				);
			case 1:
				return (
					<div className="space-y-5">
						<div className="space-y-3">
							<Title title={getStepTitle()} />
							<Description description="Upload a video, generate captions automatically, fine-tune timing and styling, then export your finished clip." />
							<Description description="Projects are temporary — your media is removed after a period of inactivity for your privacy." />
						</div>
						<NextButton onClick={handleNext}>Next</NextButton>
					</div>
				);
			case 2:
				return (
					<div className="space-y-5">
						<div className="space-y-3">
							<Title title={getStepTitle()} />
							<Description
								description={`${BRAND.productName} is a product by [${BRAND.parentCompany}](${BRAND.companyWebsite}). Need help? Visit our [contact page](/${ROUTES.contact.slice(1)}).`}
							/>
						</div>
						<NextButton onClick={handleClose}>Start</NextButton>
					</div>
				);
			default:
				return null;
		}
	};

	return (
		<Dialog open={isOpen} onOpenChange={handleClose}>
			<DialogContent className="sm:max-w-[425px]">
				<DialogTitle>
					<span className="sr-only">{getStepTitle()}</span>
				</DialogTitle>
				<DialogBody>{renderStepContent()}</DialogBody>
			</DialogContent>
		</Dialog>
	);
}

function Title({ title }: { title: string }) {
	return <h2 className="text-lg font-bold md:text-xl">{title}</h2>;
}

function Description({ description }: { description: string }) {
	return (
		<div className="text-muted-foreground">
			<p className="mb-0 whitespace-pre-line">{description}</p>
		</div>
	);
}

function NextButton({
	children,
	onClick,
}: {
	children: React.ReactNode;
	onClick: () => void;
}) {
	return (
		<Button onClick={onClick} variant="default" className="w-full">
			{children}
			<ArrowRightIcon className="size-4" />
		</Button>
	);
}

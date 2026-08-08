import { z } from "zod";

export const PRIVATE_SERVER_PRICE_LABEL = "₹10,000/year";

export const PRIVATE_SERVER_WORKLOAD_OPTIONS = [
	"Under 10,000 jobs/month",
	"10,000-50,000 jobs/month",
	"50,000-250,000 jobs/month",
	"250,000+ jobs/month",
	"Not sure yet",
] as const;

export const PRIVATE_SERVER_USE_CASE_OPTIONS = [
	"Caption processing",
	"Video export/render workloads",
	"Dedicated worker capacity",
	"API / automation workloads",
	"Enterprise reliability and support",
	"Other",
] as const;

export const PRIVATE_SERVER_CONTACT_METHOD_OPTIONS = [
	"Email",
	"Phone",
	"WhatsApp",
	"Video call",
] as const;

function cleanText({ value, maxLength }: { value: string | null | undefined; maxLength: number }) {
	const cleaned = (value ?? "")
		.split("")
		.map((character) => {
			const code = character.charCodeAt(0);
			return code < 32 || code === 127 ? " " : character;
		})
		.join("")
		.replace(/[<>]/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, maxLength);
	return cleaned.length > 0 ? cleaned : null;
}

const optionalText = ({ maxLength }: { maxLength: number }) =>
	z
		.string()
		.optional()
		.transform((value) => cleanText({ value, maxLength }));

const requiredText = ({
	maxLength,
	message,
}: {
	maxLength: number;
	message: string;
}) =>
	z
		.string()
		.transform((value) => cleanText({ value, maxLength }) ?? "")
		.pipe(z.string().min(1, message).max(maxLength));

export const privateServerRequestSchema = z.object({
	fullName: requiredText({ maxLength: 160, message: "Full name is required." }),
	email: z
		.string()
		.transform((value) => value.trim().toLowerCase().slice(0, 320))
		.pipe(z.email("Enter a valid work email.")),
	companyName: requiredText({
		maxLength: 180,
		message: "Company or organization is required.",
	}),
	phone: optionalText({ maxLength: 80 }),
	website: optionalText({ maxLength: 300 }),
	teamSize: optionalText({ maxLength: 80 }),
	monthlyWorkload: z.enum(PRIVATE_SERVER_WORKLOAD_OPTIONS),
	primaryUseCase: z.enum(PRIVATE_SERVER_USE_CASE_OPTIONS),
	currentPlanOrUsage: optionalText({ maxLength: 240 }),
	preferredContactMethod: z.enum(PRIVATE_SERVER_CONTACT_METHOD_OPTIONS).optional().nullable(),
	preferredContactTime: optionalText({ maxLength: 160 }),
	technicalRequirements: optionalText({ maxLength: 1200 }),
	message: requiredText({ maxLength: 2000, message: "Message is required." }),
	consentToContact: z.literal(true, {
		error: "Consent is required before we can contact you.",
	}),
	websiteConfirmation: z.string().max(0).optional(),
});

export type PrivateServerRequestInput = z.input<typeof privateServerRequestSchema>;
export type PrivateServerRequestValues = z.output<typeof privateServerRequestSchema>;

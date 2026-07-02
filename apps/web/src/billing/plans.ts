export const PRIVATE_SERVER_PRICE_INR = 8000;
export const PRIVATE_SERVER_PRICE_PAISE = PRIVATE_SERVER_PRICE_INR * 100;

export const DONATION_LEVELS = [
	{ amount: 100, label: "Helping Hand" },
	{ amount: 250, label: "Chai Champion" },
	{ amount: 500, label: "Bug Buster" },
	{ amount: 1000, label: "Server Savior" },
	{ amount: 2500, label: "Caption Commander" },
	{ amount: 5000, label: "Render Hero" },
	{ amount: 10000, label: "Production Protector" },
	{ amount: 25000, label: "Infrastructure Legend" },
	{ amount: 50000, label: "You Are the God" },
] as const;

export function isDonationAmount(value: number) {
	return DONATION_LEVELS.some((level) => level.amount === value);
}

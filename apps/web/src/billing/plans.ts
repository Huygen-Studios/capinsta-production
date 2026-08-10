export const PRIVATE_SERVER_PRODUCT = {
	code: "private_server",
	displayName: "Private Server",
	indicativePriceInr: 10000,
	indicativePriceLabel: "₹10,000/year",
	active: true,
	salesAssisted: true,
} as const;

export const DONATION_TIERS = [
	{ id: "helping_hand", label: "₹100", title: "Helping Hand", amountInr: 100, amountPaise: 10000, active: true, sortOrder: 1 },
	{ id: "chai_champion", label: "₹250", title: "Chai Champion", amountInr: 250, amountPaise: 25000, active: true, sortOrder: 2 },
	{ id: "bug_buster", label: "₹500", title: "Bug Buster", amountInr: 500, amountPaise: 50000, active: true, sortOrder: 3 },
	{ id: "server_savior", label: "₹1,000", title: "Server Savior", amountInr: 1000, amountPaise: 100000, active: true, sortOrder: 4 },
	{ id: "caption_commander", label: "₹2,500", title: "Caption Commander", amountInr: 2500, amountPaise: 250000, active: true, sortOrder: 5 },
	{ id: "render_hero", label: "₹5,000", title: "Render Hero", amountInr: 5000, amountPaise: 500000, active: true, sortOrder: 6 },
] as const;

export const DONATION_LEVELS = DONATION_TIERS.map((tier) => ({
	amount: tier.amountInr,
	label: tier.title,
	id: tier.id,
	amountPaise: tier.amountPaise,
}));

export type DonationTierId = (typeof DONATION_TIERS)[number]["id"];

export function findDonationTier(id: string) {
	return DONATION_TIERS.find((tier) => tier.id === id && tier.active) ?? null;
}

export function findDonationTierByAmount(amountInr: number) {
	return DONATION_TIERS.find((tier) => tier.amountInr === amountInr && tier.active) ?? null;
}

export function isDonationAmount(value: number) {
	return DONATION_TIERS.some((tier) => tier.amountInr === value && tier.active);
}

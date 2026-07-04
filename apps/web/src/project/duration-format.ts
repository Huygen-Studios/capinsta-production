const TICKS_PER_SECOND = 120_000;

export function formatProjectDurationTicks({
	duration,
	emptyValue = null,
}: {
	duration: number | undefined;
	emptyValue?: string | null;
}): string | null {
	if (duration === undefined) {
		return emptyValue;
	}

	if (duration <= 0) {
		return "0:00";
	}

	const durationSeconds = Math.max(0, Math.floor(duration / TICKS_PER_SECOND));
	const hours = Math.floor(durationSeconds / 3600);
	const minutes = Math.floor((durationSeconds % 3600) / 60);
	const seconds = durationSeconds % 60;

	if (hours > 0) {
		return `${hours.toString().padStart(2, "0")}:${minutes
			.toString()
			.padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
	}

	return `${minutes.toString().padStart(2, "0")}:${seconds
		.toString()
		.padStart(2, "0")}`;
}

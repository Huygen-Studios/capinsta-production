"use client";

export function CapinstaColorControl({
	label,
	value,
	mixed = false,
	onChange,
}: {
	label: string;
	value: string;
	mixed?: boolean;
	onChange: (value: string) => void;
}) {
	return (
		<label className="flex items-center justify-between gap-3 text-xs">
			<span className="text-muted-foreground">
				{label}
				{mixed ? <span className="ml-2 font-mono text-foreground">Mixed</span> : null}
			</span>
			<input
				type="color"
				value={value.startsWith("#") ? value.slice(0, 7) : "#ffffff"}
				onChange={(event) => onChange(event.currentTarget.value)}
				className="h-7 w-10 cursor-pointer rounded border bg-transparent p-0"
			/>
		</label>
	);
}

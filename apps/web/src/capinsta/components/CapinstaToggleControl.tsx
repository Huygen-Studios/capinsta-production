"use client";

export function CapinstaToggleControl({
	label,
	checked,
	mixed = false,
	onChange,
}: {
	label: string;
	checked: boolean;
	mixed?: boolean;
	onChange: (checked: boolean) => void;
}) {
	return (
		<label className="flex items-center justify-between gap-3 text-xs">
			<span className="text-muted-foreground">
				{label}
				{mixed ? <span className="ml-2 font-mono text-foreground">Mixed</span> : null}
			</span>
			<input
				type="checkbox"
				checked={checked}
				onChange={(event) => onChange(event.currentTarget.checked)}
			/>
		</label>
	);
}

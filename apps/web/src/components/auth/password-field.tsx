"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { authInputClass } from "./auth-shell";

export function PasswordField({
	id,
	label,
	value,
	onChange,
	autoComplete,
	minLength = 8,
}: {
	id: string;
	label: string;
	value: string;
	onChange: (value: string) => void;
	autoComplete: string;
	minLength?: number;
}) {
	const [visible, setVisible] = useState(false);
	return (
		<label htmlFor={id} className="block text-sm font-semibold text-foreground">
			{label}
			<span className="relative block">
				<input
					id={id}
					name={id}
					type={visible ? "text" : "password"}
					value={value}
					onChange={(event) => onChange(event.target.value)}
					autoComplete={autoComplete}
					minLength={minLength}
					required
					className={`${authInputClass} pr-11`}
				/>
				<button
					type="button"
					onClick={() => setVisible((current) => !current)}
					className="absolute right-0 top-2 flex h-11 w-11 items-center justify-center text-muted-foreground hover:text-foreground"
					aria-label={visible ? "Hide password" : "Show password"}
				>
					{visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
				</button>
			</span>
		</label>
	);
}

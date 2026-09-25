"use client";

import { useId } from "react";
import type React from "react";
import { m } from "framer-motion";
import { springs } from "../lib/motion";

interface SwitchProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'> {
	label?: string;
	checked?: boolean;
	onChange?: (checked: boolean) => void;
	/** Enable frosted glass effect */
	glass?: boolean;
}

export function Switch({
	className = "",
	label,
	checked,
	onChange,
	disabled,
	glass: _glass = false,
	...props
}: SwitchProps) {
	const id = useId();

	return (
		<label
			htmlFor={id}
			className={`inline-flex items-center gap-2 text-[13px] text-foreground ${
				disabled ? "opacity-50 cursor-default" : "cursor-pointer"
			} ${className}`}
		>
			<span className="relative inline-flex items-center">
				<input
					id={id}
					type="checkbox"
					checked={checked}
					disabled={disabled}
					onChange={(e) => onChange && onChange(e.target.checked)}
					{...props}
					className="peer absolute inset-0 h-full w-full cursor-pointer opacity-0"
				/>
				<span
					className={`flex h-6 w-11 items-center rounded-full px-0.5 transition-all duration-200 peer-focus-visible:ring-2 peer-focus-visible:ring-mac-blue/50 ${
						checked
							? "bg-mac-blue"
							: "bg-mac-control"
					}`}
				>
					<m.span
						animate={{
							x: checked ? 20 : 0,
						}}
						transition={springs.smooth}
						className="h-5 w-5 rounded-full bg-white shadow-sm"
					/>
				</span>
			</span>
			{label ? <span>{label}</span> : null}
		</label>
	);
}

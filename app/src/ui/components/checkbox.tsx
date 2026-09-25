"use client";

import { useId } from "react";
import type React from "react";
import { m } from "framer-motion";
import { springs, durations } from "../lib/motion";

interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'size'> {
	boxClassName?: string;
	label?: React.ReactNode;
	checked?: boolean;
	indeterminate?: boolean;
	onChange?: (checked: boolean) => void;
	/** Checkbox size: sm = 14px (compact), md = 16px (default) */
	size?: 'sm' | 'md';
	/** Enable frosted glass effect */
	glass?: boolean;
}

const SIZE_CONFIG = {
	sm: {
		wrapper: "h-3.5 w-3.5",
		box: "h-3.5 w-3.5 rounded",
		check: "h-2.5 w-2.5",
		dash: "w-1.5 h-px",
	},
	md: {
		wrapper: "h-4 w-4",
		box: "h-4 w-4 rounded-sm",
		check: "h-2.75 w-2.75",
		dash: "w-2 h-0.5",
	},
} as const;

export function Checkbox({
	className = "",
	boxClassName = "",
	label,
	checked,
	indeterminate = false,
	onChange,
	disabled,
	size = "md",
	glass = false,
	...props
}: CheckboxProps) {
	const id = useId();
	const isActive = checked || indeterminate;
	const s = SIZE_CONFIG[size];

	return (
		<label
			htmlFor={id}
			className={`inline-flex items-center gap-2 text-[13px] text-foreground ${
				disabled ? "opacity-50 cursor-default" : "cursor-pointer"
			} ${className}`}
		>
			<span className={`relative flex ${s.wrapper} items-center justify-center`}>
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
					className={`flex items-center justify-center border transition-all duration-150 text-white peer-focus-visible:ring-2 peer-focus-visible:ring-mac-blue/50 peer-focus-visible:ring-inset ${s.box} ${
						isActive
							? "bg-mac-blue border-mac-blue"
							: "bg-mac-elevated border-mac-border"
					} ${boxClassName}`}
				>
					{indeterminate ? (
						<m.div
							initial={{ scale: 0 }}
							animate={{ scale: 1 }}
							transition={springs.smooth}
							className={`${s.dash} bg-white rounded`}
						/>
					) : (
						<m.svg
							viewBox="0 0 16 16"
							aria-hidden="true"
							className={s.check}
							initial={false}
							animate={{
								opacity: checked ? 1 : 0,
								scale: checked ? 1 : 0.5,
							}}
							transition={springs.smooth}
						>
							<m.polyline
								points="3.5 8.5 6.5 11.5 12.5 4.5"
								fill="none"
								stroke="currentColor"
								strokeWidth="1.8"
								strokeLinecap="round"
								strokeLinejoin="round"
								initial={{ pathLength: 0 }}
								animate={{ pathLength: checked ? 1 : 0 }}
								transition={{ duration: durations.base }}
							/>
						</m.svg>
					)}
				</span>
			</span>
			{label ? <span>{label}</span> : null}
		</label>
	);
}

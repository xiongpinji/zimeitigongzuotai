"use client";

import { twMerge } from "tailwind-merge";
import { X } from "lucide-react";

interface CloseButtonProps {
	onClick?: () => void;
	href?: string;
	className?: string;
}

export function CloseButton({
	onClick,
	href,
	className = "",
}: CloseButtonProps) {
	// macOS 红灯：默认纯红圆点，hover 时显出深色 × 字形（与系统窗口关闭按钮一致）。
	const dotClasses =
		"group relative inline-flex items-center justify-center w-3.5 h-3.5 bg-red-500 rounded-full hover:bg-red-500/90 transition-colors";

	const glyph = (
		<X
			className="w-2 h-2 text-black/55 opacity-0 group-hover:opacity-100 transition-opacity"
			strokeWidth={3.5}
		/>
	);

	const wrapperClasses =
		"inline-flex items-center justify-center min-w-3.5 min-h-3.5 outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:ring-offset-2 rounded-full transition-shadow duration-150";

	if (href) {
		return (
			<a href={href} className={twMerge(wrapperClasses, className)}>
				<span className={dotClasses}>{glyph}</span>
			</a>
		);
	}

	return (
		<button
			onClick={onClick}
			className={twMerge(wrapperClasses, className)}
			aria-label="Close"
		>
			<span className={dotClasses}>{glyph}</span>
		</button>
	);
}

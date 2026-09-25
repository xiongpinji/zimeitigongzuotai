"use client";

import type React from "react";
import { cn } from "../lib/utils";
import { getDuration } from "../lib/animation-config";
import { m } from "framer-motion";

export type BadgeVariant =
	| "default"
	| "secondary"
	| "outline"
	| "destructive"
	| "success"
	| "warning"
	| "info"
	| "published"
	| "draft"
	| "archived"
	| "new"
	| "read"
	| "responded"
	| "glass";

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
	variant?: BadgeVariant;
	/** Badge size: xs = 9px compact rounded, sm = 10px pill (default) */
	size?: "xs" | "sm";
	/** Custom color (hex). Overrides variant — sets text color and 10% tinted background. */
	color?: string;
	children: React.ReactNode;
}

const SIZE_CLASSES = {
	xs: "px-1.5 py-0.5 text-[9px] rounded",
	sm: "px-2 py-0.5 text-[10px] rounded-full",
} as const;

export function Badge({
	variant = "default",
	size = "sm",
	color,
	className,
	style,
	children,
	...props
}: BadgeProps) {
	const variants: Record<BadgeVariant, string> = {
		default: "border-transparent bg-secondary text-secondary-foreground",
		secondary: "border-transparent bg-muted text-muted-foreground",
		outline: "border-border bg-transparent text-muted-foreground",
		glass: "border-transparent bg-muted text-muted-foreground",
		destructive: "border-transparent bg-red-500/15 text-red-400",
		success: "border-transparent bg-emerald-500/15 text-emerald-400",
		published: "border-transparent bg-emerald-500/15 text-emerald-400",
		warning: "border-transparent bg-amber-500/15 text-amber-300",
		draft: "border-transparent bg-amber-500/15 text-amber-300",
		read: "border-transparent bg-amber-500/15 text-amber-300",
		info: "border-transparent bg-sky-500/15 text-sky-300",
		new: "border-transparent bg-sky-500/15 text-sky-300",
		responded: "border-transparent bg-emerald-500/15 text-emerald-400",
		archived: "border-transparent bg-muted text-muted-foreground",
	};

	const hasCustomColor = !!color;
	const colorStyle: React.CSSProperties | undefined = hasCustomColor
		? {
				color,
				backgroundColor: `color-mix(in srgb, ${color} 10%, transparent)`,
				...style,
			}
		: style;

	return (
		<m.span
			initial={{ opacity: 0 }}
			animate={{ opacity: 1 }}
			transition={{ duration: getDuration("normal") }}
			{...(props as any)}
			style={colorStyle}
			className={cn(
				"inline-flex items-center justify-center gap-1 border font-semibold tracking-[0.02em] leading-tight focus:outline-none focus:ring-1 focus:ring-ring/50",
				SIZE_CLASSES[size],
				hasCustomColor ? "border-transparent" : variants[variant],
				className,
			)}
		>
			{children}
		</m.span>
	);
}

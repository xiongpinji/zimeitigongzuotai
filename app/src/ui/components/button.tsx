"use client";

import * as React from "react";
import { twMerge } from "tailwind-merge";
import { clsx, type ClassValue } from "clsx";
import { m } from "framer-motion";
import { Loader2 } from "lucide-react";
import { springs } from "../lib/motion";

function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

// ============================================================================
// Types
// ============================================================================

export type ButtonVariant =
	| "default"
	| "primary"
	| "secondary"
	| "success"
	| "warning"
	| "info"
	| "destructive"
	| "outline"
	| "ghost"
	| "link"
	| "accent";

export type ButtonSize = "default" | "xs" | "sm" | "lg" | "icon";
type ButtonSizeAlias = ButtonSize | "md";

// Legacy exports for backward compatibility
export type Variant = ButtonVariant;
export type Size = ButtonSize;

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
	/** Button style variant */
	variant?: ButtonVariant;
	/** Button size */
	size?: ButtonSizeAlias;
	/** Additional CSS classes */
	className?: string;
	/** Button content */
	children?: React.ReactNode;
	/** Show loading spinner */
	loading?: boolean;
	/** Text to show while loading (replaces children) */
	loadingText?: string;
	/** Icon to show on the left side */
	leftIcon?: React.ReactNode;
	/** Icon to show on the right side */
	rightIcon?: React.ReactNode;
	/** Make button full width */
	fullWidth?: boolean;
	/** Render as icon-only button (square aspect ratio) */
	iconOnly?: boolean;
	/** Enable frosted glass hover effect */
	glass?: boolean;
}

// ============================================================================
// Variant & Size Classes
// ============================================================================

const variantClasses: Record<ButtonVariant, string> = {
	default:
		"bg-mac-control text-white hover:brightness-110",
	primary: "bg-mac-blue text-white hover:brightness-110",
	secondary:
		"bg-mac-control text-white hover:brightness-110",
	success: "bg-mac-green text-white hover:brightness-110",
	warning: "bg-mac-yellow text-black hover:brightness-110",
	info: "bg-mac-blue text-white hover:brightness-110",
	destructive: "bg-mac-red/10 text-mac-red border border-mac-red/25 hover:bg-mac-red/20",
	outline:
		"border border-mac-border bg-transparent text-foreground hover:bg-mac-control/50",
	ghost: "text-mac-text-muted bg-white/[0.05] hover:bg-white/[0.1]",
	link: "text-foreground underline-offset-4 hover:underline",
	accent: "bg-mac-blue/10 text-mac-blue border border-mac-blue/25 hover:bg-mac-blue/20",
};

const sizeClasses: Record<ButtonSizeAlias, string> = {
	default: "h-[30px] rounded-lg px-3.5 py-[7px]",
	md: "h-[30px] rounded-lg px-3.5 py-[7px]",
	xs: "h-[22px] rounded-[5px] px-2 text-[10px]",
	sm: "h-[26px] rounded-md px-2.5 text-[11px]",
	lg: "h-9 rounded-lg px-4 text-[13px]",
	icon: "h-[30px] w-[30px] rounded-lg",
};

const iconSizeClasses: Record<ButtonSizeAlias, string> = {
	default: "w-3.5 h-3.5",
	md: "w-3.5 h-3.5",
	xs: "w-2.5 h-2.5",
	sm: "w-3 h-3",
	lg: "w-4 h-4",
	icon: "w-3.5 h-3.5",
};

// ============================================================================
// Button Base Component
// ============================================================================

const ButtonBase = React.forwardRef<HTMLButtonElement, ButtonProps>(
	(
		{
			children,
			variant = "default",
			size = "default",
			className,
			loading = false,
			loadingText,
			leftIcon,
			rightIcon,
			fullWidth = false,
			iconOnly = false,
			glass = false,
			disabled,
			...props
		},
		ref,
	) => {
		const isDisabled = disabled || loading;
		const effectiveSize: ButtonSizeAlias = iconOnly ? "icon" : size;
		const iconClasses = iconSizeClasses[effectiveSize];

		const content = loading ? (
			<>
				<Loader2 className={cn(iconClasses, "animate-spin")} />
				{loadingText && <span>{loadingText}</span>}
			</>
		) : (
			<>
				{leftIcon && (
					<span className={cn(iconClasses, "shrink-0")}>{leftIcon}</span>
				)}
				{children}
				{rightIcon && (
					<span className={cn(iconClasses, "shrink-0")}>{rightIcon}</span>
				)}
			</>
		);

		return (
			<m.button
				ref={ref}
				disabled={isDisabled}
				whileTap={!isDisabled ? { scale: 0.96 } : undefined}
				transition={springs.snappy}
				className={cn(
					"inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg text-[12px] font-medium leading-none transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-0 disabled:pointer-events-none disabled:opacity-50",
					variantClasses[variant],
					sizeClasses[effectiveSize],
					fullWidth && "w-full",
					className,
				)}
				// biome-ignore lint/suspicious/noExplicitAny: Framer Motion onDrag conflicts with HTML onDrag
				{...(props as any)}
			>
				{content}
			</m.button>
		);
	},
);
ButtonBase.displayName = "Button";

// ============================================================================
// Compound Components
// ============================================================================

const IconButton = React.forwardRef<
	HTMLButtonElement,
	Omit<ButtonProps, "iconOnly" | "leftIcon" | "rightIcon">
>((props, ref) => <ButtonBase ref={ref} iconOnly size="icon" {...props} />);
IconButton.displayName = "Button.Icon";

const LinkButton = React.forwardRef<
	HTMLButtonElement,
	Omit<ButtonProps, "variant">
>((props, ref) => <ButtonBase ref={ref} variant="link" {...props} />);
LinkButton.displayName = "Button.Link";

const GhostButton = React.forwardRef<
	HTMLButtonElement,
	Omit<ButtonProps, "variant">
>((props, ref) => <ButtonBase ref={ref} variant="ghost" {...props} />);
GhostButton.displayName = "Button.Ghost";

const OutlineButton = React.forwardRef<
	HTMLButtonElement,
	Omit<ButtonProps, "variant">
>((props, ref) => <ButtonBase ref={ref} variant="outline" {...props} />);
OutlineButton.displayName = "Button.Outline";

const DestructiveButton = React.forwardRef<
	HTMLButtonElement,
	Omit<ButtonProps, "variant">
>((props, ref) => <ButtonBase ref={ref} variant="destructive" {...props} />);
DestructiveButton.displayName = "Button.Destructive";

// ============================================================================
// Export
// ============================================================================

type ButtonComponent = typeof ButtonBase & {
	Icon: typeof IconButton;
	Link: typeof LinkButton;
	Ghost: typeof GhostButton;
	Outline: typeof OutlineButton;
	Destructive: typeof DestructiveButton;
};

const Button = ButtonBase as ButtonComponent;
Button.Icon = IconButton;
Button.Link = LinkButton;
Button.Ghost = GhostButton;
Button.Outline = OutlineButton;
Button.Destructive = DestructiveButton;

export { Button };

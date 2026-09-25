"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { m, AnimatePresence } from "framer-motion";
import { cn } from "../lib/utils";
import { durations, easings, springs } from "../lib/motion";

// ============================================================================
// Types
// ============================================================================

type FloatingTrigger = "click" | "hover";
type FloatingSide = "top" | "bottom" | "left" | "right";
type FloatingAlign = "start" | "center" | "end";
type FloatingSize = "sm" | "md" | "lg";
type RectLike = {
	top: number;
	left: number;
	right: number;
	bottom: number;
	width: number;
	height: number;
};

interface FloatingContextValue {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	triggerRef: React.RefObject<HTMLElement | null>;
	trigger: FloatingTrigger;
	delayDuration: number;
	size: FloatingSize;
}

const FloatingContext = React.createContext<FloatingContextValue | undefined>(
	undefined,
);

function useFloatingContext() {
	const context = React.useContext(FloatingContext);
	if (!context) {
		throw new Error(
			"Floating components must be used within a Floating provider",
		);
	}
	return context;
}

// ============================================================================
// Position Calculation Hook
// ============================================================================

function useFloatingPosition(
	open: boolean,
	triggerRef: React.RefObject<HTMLElement | null>,
	contentRef: React.RefObject<HTMLElement | null>,
	side: FloatingSide,
	align: FloatingAlign,
	sideOffset: number,
) {
	const [position, setPosition] = React.useState({ top: 0, left: 0 });

	React.useEffect(() => {
		if (!open || !triggerRef.current || !contentRef.current) return;

		const triggerRect = triggerRef.current.getBoundingClientRect();
		const contentRect = contentRef.current.getBoundingClientRect();

		setPosition(
			computeFloatingPosition({
				triggerRect,
				contentRect,
				viewportRect: {
					width: window.innerWidth,
					height: window.innerHeight,
				},
				side,
				align,
				sideOffset,
				viewportPadding: 8,
			}),
		);
	}, [open, side, align, sideOffset, triggerRef, contentRef]);

	return position;
}

// ============================================================================
// Transform Utilities
// ============================================================================

function getTransformOrigin(side: FloatingSide, align: FloatingAlign) {
	switch (side) {
		case "top":
			return align === "start"
				? "bottom left"
				: align === "end"
					? "bottom right"
					: "bottom center";
		case "bottom":
			return align === "start"
				? "top left"
				: align === "end"
					? "top right"
					: "top center";
		case "left":
			return "right center";
		case "right":
			return "left center";
	default:
			return "top center";
	}
}

function clamp(value: number, min: number, max: number) {
	return Math.min(Math.max(value, min), max);
}

export function computeFloatingPosition({
	triggerRect,
	contentRect,
	viewportRect,
	side,
	align,
	sideOffset,
	viewportPadding,
}: {
	triggerRect: RectLike;
	contentRect: Pick<RectLike, "width" | "height">;
	viewportRect: { width: number; height: number };
	side: FloatingSide;
	align: FloatingAlign;
	sideOffset: number;
	viewportPadding: number;
}) {
	let top = 0;
	let left = 0;

	switch (side) {
		case "top":
			top = triggerRect.top - contentRect.height - sideOffset;
			break;
		case "bottom":
			top = triggerRect.bottom + sideOffset;
			break;
		case "left":
			top = triggerRect.top + (triggerRect.height - contentRect.height) / 2;
			left = triggerRect.left - contentRect.width - sideOffset;
			break;
		case "right":
			top = triggerRect.top + (triggerRect.height - contentRect.height) / 2;
			left = triggerRect.right + sideOffset;
			break;
	}

	if (side === "top" || side === "bottom") {
		switch (align) {
			case "start":
				left = triggerRect.left;
				break;
			case "center":
				left = triggerRect.left + (triggerRect.width - contentRect.width) / 2;
				break;
			case "end":
				left = triggerRect.right - contentRect.width;
				break;
		}
	}

	const maxLeft = Math.max(viewportPadding, viewportRect.width - contentRect.width - viewportPadding);
	const maxTop = Math.max(viewportPadding, viewportRect.height - contentRect.height - viewportPadding);

	return {
		left: clamp(left, viewportPadding, maxLeft),
		top: clamp(top, viewportPadding, maxTop),
	};
}

function getAnimationProps(
	side: FloatingSide,
	trigger: FloatingTrigger,
): {
	initial: { opacity: number; y?: number; x?: number; scale?: number };
	animate: { opacity: number; y?: number; x?: number; scale?: number };
	exit: { opacity: number; y?: number; x?: number; scale?: number };
} {
	// Tooltips use opacity-only to prevent hover detection issues
	if (trigger === "hover") {
		return {
			initial: { opacity: 0 },
			animate: { opacity: 1 },
			exit: { opacity: 0 },
		};
	}

	// Popovers use directional slide + scale(大幅度,明确方向感)
	switch (side) {
		case "top":
			return {
				initial: { opacity: 0, y: 8, scale: 0.94 },
				animate: { opacity: 1, y: 0, scale: 1 },
				exit: { opacity: 0, y: 4, scale: 0.94 },
			};
		case "bottom":
			return {
				initial: { opacity: 0, y: -8, scale: 0.94 },
				animate: { opacity: 1, y: 0, scale: 1 },
				exit: { opacity: 0, y: -4, scale: 0.94 },
			};
		case "left":
			return {
				initial: { opacity: 0, x: 8, scale: 0.94 },
				animate: { opacity: 1, x: 0, scale: 1 },
				exit: { opacity: 0, x: 4, scale: 0.94 },
			};
		case "right":
			return {
				initial: { opacity: 0, x: -8, scale: 0.94 },
				animate: { opacity: 1, x: 0, scale: 1 },
				exit: { opacity: 0, x: -4, scale: 0.94 },
			};
		default:
			return {
				initial: { opacity: 0, scale: 0.94 },
				animate: { opacity: 1, scale: 1 },
				exit: { opacity: 0, scale: 0.94 },
			};
	}
}

// ============================================================================
// Size Classes
// ============================================================================

const sizeClasses: Record<FloatingSize, string> = {
	sm: "px-3 py-1.5 text-xs", // Tooltip
	md: "p-4 w-72", // Popover
	lg: "p-6 w-96", // Large popover
};

// ============================================================================
// Floating Root Component
// ============================================================================

interface FloatingProps {
	children: React.ReactNode;
	/** Trigger behavior */
	trigger?: FloatingTrigger;
	/** Delay before showing on hover (ms) */
	delayDuration?: number;
	/** Size preset */
	size?: FloatingSize;
	/** Controlled open state */
	open?: boolean;
	/** Callback when open state changes */
	onOpenChange?: (open: boolean) => void;
	/** Default open state */
	defaultOpen?: boolean;
}

function FloatingRoot({
	children,
	trigger = "click",
	delayDuration = 300,
	size = "md",
	open: controlledOpen,
	onOpenChange,
	defaultOpen = false,
}: FloatingProps) {
	const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
	const triggerRef = React.useRef<HTMLElement>(null);

	const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
	const handleOpenChange = onOpenChange || setInternalOpen;

	// Click outside and escape handlers for click-triggered floating
	React.useEffect(() => {
		if (trigger !== "click") return;

		const handleClickOutside = (event: MouseEvent) => {
			if (
				open &&
				triggerRef.current &&
				!triggerRef.current.contains(event.target as Node)
			) {
				const contentElement = document.querySelector(
					"[data-floating-content]",
				);
				if (contentElement && !contentElement.contains(event.target as Node)) {
					handleOpenChange(false);
				}
			}
		};

		const handleEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape" && open) {
				handleOpenChange(false);
			}
		};

		document.addEventListener("mousedown", handleClickOutside);
		document.addEventListener("keydown", handleEscape);

		return () => {
			document.removeEventListener("mousedown", handleClickOutside);
			document.removeEventListener("keydown", handleEscape);
		};
	}, [open, handleOpenChange, trigger]);

	return (
		<FloatingContext.Provider
			value={{
				open,
				onOpenChange: handleOpenChange,
				triggerRef,
				trigger,
				delayDuration,
				size,
			}}
		>
			<div className="relative inline-flex">{children}</div>
		</FloatingContext.Provider>
	);
}

// ============================================================================
// Floating Trigger
// ============================================================================

interface FloatingTriggerProps {
	children: React.ReactNode;
	className?: string;
	asChild?: boolean;
}

function FloatingTrigger({ children, className, asChild }: FloatingTriggerProps) {
	const { open, onOpenChange, triggerRef, trigger, delayDuration } =
		useFloatingContext();
	const timeoutRef = React.useRef<ReturnType<typeof setTimeout> | undefined>(
		undefined,
	);

	const handleMouseEnter = () => {
		if (trigger !== "hover") return;
		timeoutRef.current = setTimeout(() => {
			onOpenChange(true);
		}, delayDuration);
	};

	const handleMouseLeave = () => {
		if (trigger !== "hover") return;
		if (timeoutRef.current) {
			clearTimeout(timeoutRef.current);
		}
		onOpenChange(false);
	};

	const handleClick = () => {
		if (trigger !== "click") return;
		onOpenChange(!open);
	};

	React.useEffect(() => {
		return () => {
			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current);
			}
		};
	}, []);

	const eventHandlers = {
		...(trigger === "click" && { onClick: handleClick }),
		...(trigger === "hover" && {
			onMouseEnter: handleMouseEnter,
			onMouseLeave: handleMouseLeave,
			onFocus: () => onOpenChange(true),
			onBlur: () => onOpenChange(false),
		}),
	};

	if (asChild && React.isValidElement(children)) {
		return React.cloneElement(
			children as React.ReactElement<{
				ref?: React.Ref<HTMLElement>;
				onClick?: () => void;
				onMouseEnter?: () => void;
				onMouseLeave?: () => void;
				onFocus?: () => void;
				onBlur?: () => void;
				"aria-expanded"?: boolean;
				"aria-haspopup"?: "dialog" | true | false;
			}>,
			{
				ref: triggerRef,
				...eventHandlers,
				"aria-expanded": open,
				"aria-haspopup": trigger === "click" ? ("dialog" as const) : undefined,
			},
		);
	}

	const Comp = trigger === "click" ? "button" : "span";

	return (
		<Comp
			ref={triggerRef as React.RefObject<HTMLButtonElement & HTMLSpanElement>}
			type={trigger === "click" ? "button" : undefined}
			{...eventHandlers}
			aria-expanded={open}
			aria-haspopup={trigger === "click" ? "dialog" : undefined}
			className={className}
		>
			{children}
		</Comp>
	);
}

// ============================================================================
// Floating Content
// ============================================================================

interface FloatingContentProps {
	children: React.ReactNode;
	className?: string;
	side?: FloatingSide;
	align?: FloatingAlign;
	sideOffset?: number;
	/** Enable frosted glass effect */
	glass?: boolean;
}

function FloatingContent({
	children,
	className,
	side = "bottom",
	align = "center",
	sideOffset = 8,
	glass = false,
}: FloatingContentProps) {
	const { open, triggerRef, trigger, size } = useFloatingContext();
	const [mounted, setMounted] = React.useState(false);
	const contentRef = React.useRef<HTMLDivElement>(null);
	const position = useFloatingPosition(
		open,
		triggerRef,
		contentRef,
		side,
		align,
		sideOffset,
	);

	React.useEffect(() => {
		setMounted(true);
	}, []);

	const animationProps = getAnimationProps(side, trigger);

	const content = (
		<AnimatePresence>
			{open && (
				<m.div
					ref={contentRef}
					data-floating-content
					role={trigger === "hover" ? "tooltip" : undefined}
					{...animationProps}
					transition={
						trigger === "hover"
							? { duration: durations.fast, ease: easings.apple }
							: springs.swift
					}
					className={cn(
						"fixed overflow-hidden rounded-xl border text-foreground shadow-xl",
						glass
							? "bg-mac-elevated backdrop-blur-xl border-mac-separator"
							: "bg-mac-elevated backdrop-blur-md border-mac-separator",
						sizeClasses[size],
						className,
					)}
					style={{
						zIndex: 9999,
						top: position.top,
						left: position.left,
						transformOrigin: getTransformOrigin(side, align),
					}}
				>
					{children}
				</m.div>
			)}
		</AnimatePresence>
	);

	if (!mounted) return null;
	return createPortal(content, document.body);
}

// ============================================================================
// Floating Close
// ============================================================================

interface FloatingCloseProps {
	children: React.ReactNode;
	className?: string;
	asChild?: boolean;
}

function FloatingClose({ children, className, asChild }: FloatingCloseProps) {
	const { onOpenChange } = useFloatingContext();

	if (asChild && React.isValidElement(children)) {
		return React.cloneElement(
			children as React.ReactElement<{ onClick?: () => void }>,
			{
				onClick: () => onOpenChange(false),
			},
		);
	}

	return (
		<button
			type="button"
			onClick={() => onOpenChange(false)}
			className={className}
		>
			{children}
		</button>
	);
}

// ============================================================================
// Floating Arrow (placeholder for future enhancement)
// ============================================================================

interface FloatingArrowProps {
	className?: string;
}

function FloatingArrow({ className }: FloatingArrowProps) {
	// Future: implement arrow pointing to trigger
	return (
		<div
			className={cn(
				"absolute w-2 h-2 bg-mac-elevated rotate-45",
				className,
			)}
		/>
	);
}

// ============================================================================
// Compound Component Export
// ============================================================================

type FloatingComponent = typeof FloatingRoot & {
	Trigger: typeof FloatingTrigger;
	Content: typeof FloatingContent;
	Close: typeof FloatingClose;
	Arrow: typeof FloatingArrow;
};

const Floating = FloatingRoot as FloatingComponent;
Floating.Trigger = FloatingTrigger;
Floating.Content = FloatingContent;
Floating.Close = FloatingClose;
Floating.Arrow = FloatingArrow;

export { Floating };

// ============================================================================
// Pre-configured Exports (Backward Compatible)
// ============================================================================

// Tooltip - hover triggered, small size
interface TooltipProps {
	children: React.ReactNode;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	defaultOpen?: boolean;
	delayDuration?: number;
}

function TooltipRoot({ delayDuration = 300, ...props }: TooltipProps) {
	return (
		<FloatingRoot
			trigger="hover"
			size="sm"
			delayDuration={delayDuration}
			{...props}
		/>
	);
}

function TooltipProvider({ children }: { children: React.ReactNode }) {
	return <>{children}</>;
}

const TooltipTrigger = FloatingTrigger;

function TooltipContent({
	side = "top",
	sideOffset = 6,
	...props
}: FloatingContentProps) {
	return <FloatingContent side={side} sideOffset={sideOffset} {...props} />;
}

export {
	TooltipProvider,
	TooltipRoot as Tooltip,
	TooltipTrigger,
	TooltipContent,
};

// Popover - click triggered, medium size
interface PopoverProps {
	children: React.ReactNode;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	defaultOpen?: boolean;
}

function PopoverRoot(props: PopoverProps) {
	return <FloatingRoot trigger="click" size="md" {...props} />;
}

const PopoverTrigger = FloatingTrigger;
const PopoverContent = FloatingContent;
const PopoverClose = FloatingClose;

export { PopoverRoot as Popover, PopoverTrigger, PopoverContent, PopoverClose };

"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { m, AnimatePresence } from "framer-motion";
import { Check } from "lucide-react";
import { cn } from "../lib/utils";
import { durations, easings, springs } from "../lib/motion";

// ============================================================================
// Types
// ============================================================================

export interface ContextMenuItem {
	label: string;
	onClick: () => void;
	shortcut?: string;
	disabled?: boolean;
	separator?: boolean;
	destructive?: boolean;
}

interface ContextMenuContextValue {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	position: { x: number; y: number };
	setPosition: (pos: { x: number; y: number }) => void;
}

const ContextMenuContext = React.createContext<
	ContextMenuContextValue | undefined
>(undefined);

function useContextMenuContext() {
	const context = React.useContext(ContextMenuContext);
	if (!context) {
		throw new Error(
			"ContextMenu components must be used within a ContextMenu provider",
		);
	}
	return context;
}

// ============================================================================
// Context Menu Root
// ============================================================================

interface ContextMenuRootProps {
	children: React.ReactNode;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
}

function ContextMenuRoot({
	children,
	open: controlledOpen,
	onOpenChange,
}: ContextMenuRootProps) {
	const [internalOpen, setInternalOpen] = React.useState(false);
	const [position, setPosition] = React.useState({ x: 0, y: 0 });

	const open = controlledOpen !== undefined ? controlledOpen : internalOpen;
	const handleOpenChange = onOpenChange || setInternalOpen;

	// Handle click outside and escape
	React.useEffect(() => {
		if (!open) return;

		const handleClickOutside = (event: MouseEvent) => {
			const contentElement = document.querySelector(
				"[data-context-menu-content]",
			);
			if (contentElement && !contentElement.contains(event.target as Node)) {
				handleOpenChange(false);
			}
		};

		const handleEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				handleOpenChange(false);
			}
		};

		const handleScroll = () => {
			handleOpenChange(false);
		};

		// Small delay to avoid immediately closing on the same click
		const timeoutId = setTimeout(() => {
			document.addEventListener("mousedown", handleClickOutside);
		}, 0);

		document.addEventListener("keydown", handleEscape);
		document.addEventListener("scroll", handleScroll, true);

		return () => {
			clearTimeout(timeoutId);
			document.removeEventListener("mousedown", handleClickOutside);
			document.removeEventListener("keydown", handleEscape);
			document.removeEventListener("scroll", handleScroll, true);
		};
	}, [open, handleOpenChange]);

	return (
		<ContextMenuContext.Provider
			value={{ open, onOpenChange: handleOpenChange, position, setPosition }}
		>
			{children}
		</ContextMenuContext.Provider>
	);
}

// ============================================================================
// Context Menu Trigger
// ============================================================================

interface ContextMenuTriggerProps {
	children: React.ReactNode;
	className?: string;
	asChild?: boolean;
}

function ContextMenuTrigger({
	children,
	className,
	asChild,
}: ContextMenuTriggerProps) {
	const { onOpenChange, setPosition } = useContextMenuContext();

	const handleContextMenu = (event: React.MouseEvent) => {
		event.preventDefault();
		event.stopPropagation();

		// Calculate position with viewport bounds checking
		const x = Math.min(event.clientX, window.innerWidth - 200);
		const y = Math.min(event.clientY, window.innerHeight - 200);

		setPosition({ x, y });
		onOpenChange(true);
	};

	if (asChild && React.isValidElement(children)) {
		const child = children as React.ReactElement<{
			onContextMenu?: (e: React.MouseEvent) => void;
			className?: string;
		}>;

		return React.cloneElement(
			child,
			{
				onContextMenu: (event) => {
					handleContextMenu(event);
					child.props.onContextMenu?.(event);
				},
				className: cn(child.props.className, className),
			},
		);
	}

	return (
		<div onContextMenu={handleContextMenu} className={className}>
			{children}
		</div>
	);
}

// ============================================================================
// Context Menu Content
// ============================================================================

interface ContextMenuContentProps {
	children: React.ReactNode;
	className?: string;
	/** Enable frosted glass effect */
	glass?: boolean;
}

function ContextMenuContent({ children, className, glass = false }: ContextMenuContentProps) {
	const { open, position } = useContextMenuContext();
	const [mounted, setMounted] = React.useState(false);

	React.useEffect(() => {
		setMounted(true);
	}, []);

	const content = (
		<AnimatePresence>
			{open && (
				<m.div
					data-context-menu-content
					initial={{ opacity: 0, scale: 0.94, y: -6 }}
					animate={{
						opacity: 1,
						scale: 1,
						y: 0,
						transition: springs.swift,
					}}
					exit={{
						opacity: 0,
						scale: 0.94,
						y: -4,
						transition: { duration: durations.fast, ease: easings.apple },
					}}
					role="menu"
					aria-orientation="vertical"
					className={cn(
						"fixed w-[148px] overflow-hidden rounded-[9px] border border-mac-border p-[3px] shadow-[0_8px_18px_rgba(0,0,0,0.44)]",
						glass
							? "bg-mac-elevated border-mac-border"
							: "bg-mac-elevated border-mac-border",
						className,
					)}
					style={{
						zIndex: 9999,
						top: position.y,
						left: position.x,
						transformOrigin: "top left",
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
// Context Menu Item
// ============================================================================

interface ContextMenuItemProps {
	children: React.ReactNode;
	className?: string;
	disabled?: boolean;
	onSelect?: () => void;
	destructive?: boolean;
}

function ContextMenuItem({
	children,
	className,
	disabled,
	onSelect,
	destructive,
}: ContextMenuItemProps) {
	const { onOpenChange } = useContextMenuContext();

	const handleClick = () => {
		if (disabled) return;
		onSelect?.();
		onOpenChange(false);
	};

	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			handleClick();
		}
	};

	return (
		<button
			type="button"
			role="menuitem"
			disabled={disabled}
			onClick={handleClick}
			onKeyDown={handleKeyDown}
			className={cn(
				"flex w-full items-center rounded-[7px] px-1.5 py-[3px] text-[10px] font-medium leading-none text-foreground outline-none transition-colors hover:bg-mac-blue hover:text-white focus:bg-mac-blue focus:text-white",
				disabled && "pointer-events-none opacity-50",
				destructive &&
					"text-mac-red hover:text-white hover:bg-mac-red focus:bg-mac-red",
				className,
			)}
		>
			{children}
		</button>
	);
}

// ============================================================================
// Context Menu Checkbox Item
// ============================================================================

interface ContextMenuCheckboxItemProps {
	children: React.ReactNode;
	className?: string;
	checked?: boolean;
	onCheckedChange?: (checked: boolean) => void;
	disabled?: boolean;
}

function ContextMenuCheckboxItem({
	children,
	className,
	checked,
	onCheckedChange,
	disabled,
}: ContextMenuCheckboxItemProps) {
	const handleKeyDown = (e: React.KeyboardEvent) => {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			onCheckedChange?.(!checked);
		}
	};

	return (
		<button
			type="button"
			role="menuitemcheckbox"
			aria-checked={checked}
			disabled={disabled}
			onClick={() => onCheckedChange?.(!checked)}
			onKeyDown={handleKeyDown}
			className={cn(
				"flex w-full items-center rounded-[7px] px-1.5 py-[3px] text-[10px] font-medium leading-none text-foreground outline-none transition-colors hover:bg-mac-blue hover:text-white focus:bg-mac-blue focus:text-white",
				disabled && "pointer-events-none opacity-50",
				className,
			)}
		>
			<span className="mr-2 flex h-4 w-4 items-center justify-center">
				{checked && <Check className="h-3 w-3" />}
			</span>
			{children}
		</button>
	);
}

// ============================================================================
// Context Menu Label
// ============================================================================

interface ContextMenuLabelProps {
	children: React.ReactNode;
	className?: string;
}

function ContextMenuLabel({ children, className }: ContextMenuLabelProps) {
	return (
		<div
			className={cn(
				"px-1.5 py-[3px] text-[9px] font-semibold tracking-[0.08em] text-mac-text-muted",
				className,
			)}
		>
			{children}
		</div>
	);
}

// ============================================================================
// Context Menu Separator
// ============================================================================

interface ContextMenuSeparatorProps {
	className?: string;
}

function ContextMenuSeparator({ className }: ContextMenuSeparatorProps) {
	return (
		<div
			className={cn("-mx-[3px] my-0.5 h-px bg-mac-separator", className)}
		/>
	);
}

// ============================================================================
// Context Menu Shortcut
// ============================================================================

interface ContextMenuShortcutProps {
	children: React.ReactNode;
	className?: string;
}

function ContextMenuShortcut({
	children,
	className,
}: ContextMenuShortcutProps) {
	return (
		<span
			className={cn(
				"ml-auto text-[9px] font-medium tracking-[0.06em] text-mac-text-muted",
				className,
			)}
		>
			{children}
		</span>
	);
}

// ============================================================================
// Legacy API: fromItems helper
// ============================================================================

interface LegacyContextMenuProps {
	children: React.ReactNode;
	items: ContextMenuItem[];
	className?: string;
	/** Enable frosted glass effect */
	glass?: boolean;
}

function LegacyContextMenu({
	children,
	items,
	className,
	glass,
}: LegacyContextMenuProps) {
	return (
		<ContextMenuRoot>
			<ContextMenuTrigger className={className}>{children}</ContextMenuTrigger>
			<ContextMenuContent glass={glass}>
				{items.map((item) => (
					<React.Fragment key={item.label || item.shortcut || 'separator'}>
						{item.separator && <ContextMenuSeparator />}
						{item.label && (
							<ContextMenuItem
								disabled={item.disabled}
								onSelect={item.onClick}
								destructive={item.destructive}
							>
								<span>{item.label}</span>
								{item.shortcut && (
									<ContextMenuShortcut>{item.shortcut}</ContextMenuShortcut>
								)}
							</ContextMenuItem>
						)}
					</React.Fragment>
				))}
			</ContextMenuContent>
		</ContextMenuRoot>
	);
}

// ============================================================================
// Compound Export
// ============================================================================

type ContextMenuComponent = typeof ContextMenuRoot & {
	Trigger: typeof ContextMenuTrigger;
	Content: typeof ContextMenuContent;
	Item: typeof ContextMenuItem;
	CheckboxItem: typeof ContextMenuCheckboxItem;
	Label: typeof ContextMenuLabel;
	Separator: typeof ContextMenuSeparator;
	Shortcut: typeof ContextMenuShortcut;
	fromItems: typeof LegacyContextMenu;
};

const ContextMenu = ContextMenuRoot as ContextMenuComponent;
ContextMenu.Trigger = ContextMenuTrigger;
ContextMenu.Content = ContextMenuContent;
ContextMenu.Item = ContextMenuItem;
ContextMenu.CheckboxItem = ContextMenuCheckboxItem;
ContextMenu.Label = ContextMenuLabel;
ContextMenu.Separator = ContextMenuSeparator;
ContextMenu.Shortcut = ContextMenuShortcut;
ContextMenu.fromItems = LegacyContextMenu;

export { ContextMenu };
export default ContextMenu;

"use client";

import * as React from "react";
import { Menu, X } from "lucide-react";
import { cn } from "../lib/utils";
import { m, AnimatePresence } from "framer-motion";
import { getDuration, getSpring } from "../lib/animation-config";

// ============================================================================
// Types
// ============================================================================

interface TopbarItem {
	label: string;
	onClick: () => void;
	icon?: React.ComponentType<{ className?: string }>;
}

interface TopbarProps {
	/** Navigation items */
	items: TopbarItem[];
	/** Currently active item label */
	activeItem?: string;
	/** Logo or brand element to display on the left */
	logo?: React.ReactNode;
	/** Actions to display on the right (e.g., search, user menu) */
	actions?: React.ReactNode;
	/** Whether the topbar should stick to the top on scroll */
	sticky?: boolean;
	/** Visual variant of the topbar */
	variant?: "default" | "transparent" | "bordered";
	/** Additional className */
	className?: string;
	/** Enable frosted glass effect */
	glass?: boolean;
}

// ============================================================================
// Topbar Item Component
// ============================================================================

interface TopbarItemButtonProps {
	item: TopbarItem;
	active?: boolean;
	onClick?: () => void;
}

function TopbarItemButton({ item, active, onClick }: TopbarItemButtonProps) {
	const Icon = item.icon;

	return (
		<button
			type="button"
			onClick={onClick || item.onClick}
			className={cn(
				"group flex items-center gap-2 px-3 py-2 rounded-(--radius-lg,0.75rem) text-sm font-medium transition-all duration-200",
				"focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50",
				active
					? "bg-blue-500 text-white shadow-sm shadow-blue-500/25"
					: "text-mac-text-sec hover:bg-mac-control hover:text-foreground",
			)}
		>
			{Icon && (
				<Icon
					className={cn(
						"h-4 w-4 shrink-0 transition-colors",
						active
							? "text-white"
							: "text-mac-text-sec group-hover:text-foreground",
					)}
				/>
			)}
			<span>{item.label}</span>
		</button>
	);
}

// ============================================================================
// Mobile Menu Component
// ============================================================================

interface MobileMenuProps {
	items: TopbarItem[];
	activeItem?: string;
	isOpen: boolean;
	onClose: () => void;
}

function MobileMenu({ items, activeItem, isOpen, onClose }: MobileMenuProps) {
	return (
		<>
			{/* Overlay */}
			<AnimatePresence>
				{isOpen && (
					<m.div
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={{ duration: getDuration("fast") }}
						className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
						onClick={onClose}
						role="button"
						tabIndex={0}
						aria-label="Close menu"
					/>
				)}
			</AnimatePresence>

			{/* Slide-out menu */}
			<AnimatePresence>
				{isOpen && (
					<m.div
						initial={{ x: "100%" }}
						animate={{ x: 0 }}
						exit={{ x: "100%" }}
						transition={getSpring("smooth")}
						className="fixed right-0 top-0 z-50 h-full w-72 bg-mac-elevated border-l border-mac-separator shadow-xl md:hidden"
					>
						{/* Header */}
						<div className="flex items-center justify-between p-4 border-b border-mac-separator">
							<span className="text-sm font-semibold text-foreground">
								Menu
							</span>
							<button
								type="button"
								onClick={onClose}
								className="p-2 rounded-(--radius-lg,0.75rem) text-mac-text-muted hover:bg-mac-control hover:text-foreground transition-colors"
								aria-label="Close menu"
							>
								<X className="h-5 w-5" />
							</button>
						</div>

						{/* Items */}
						<div className="p-4 space-y-1">
							{items.map((item) => (
								<TopbarItemButton
									key={item.label}
									item={item}
									active={activeItem === item.label}
									onClick={() => {
										item.onClick();
										onClose();
									}}
								/>
							))}
						</div>
					</m.div>
				)}
			</AnimatePresence>
		</>
	);
}

// ============================================================================
// Main Topbar Component
// ============================================================================

export function Topbar({
	items,
	activeItem,
	logo,
	actions,
	sticky = false,
	variant = "default",
	className,
	glass = false,
}: TopbarProps) {
	const [mobileMenuOpen, setMobileMenuOpen] = React.useState(false);

	const variantStyles = {
		default: glass
			? "bg-mac-elevated backdrop-blur-xl border-b border-mac-separator"
			: "bg-mac-elevated backdrop-blur-md border-b border-mac-separator",
		transparent: "bg-transparent",
		bordered:
			"bg-transparent border-b border-mac-separator",
	};

	return (
		<>
			<header
				className={cn(
					"w-full z-30",
					sticky && "sticky top-0",
					variantStyles[variant],
					className,
				)}
			>
				<div className="flex items-center justify-between h-14 px-4 md:px-6">
					{/* Logo / Brand */}
					{logo && <div className="shrink-0">{logo}</div>}

					{/* Desktop Navigation */}
					<nav className="hidden md:flex items-center gap-1 ml-6">
						{items.map((item) => (
							<TopbarItemButton
								key={item.label}
								item={item}
								active={activeItem === item.label}
							/>
						))}
					</nav>

					{/* Spacer */}
					<div className="flex-1" />

					{/* Actions */}
					{actions && (
						<div className="hidden md:flex items-center gap-2">{actions}</div>
					)}

					{/* Mobile Menu Button */}
					<button
						type="button"
						onClick={() => setMobileMenuOpen(true)}
						className="md:hidden p-2 rounded-(--radius-lg,0.75rem) text-mac-text-sec hover:bg-mac-control hover:text-foreground transition-colors"
						aria-label="Open menu"
					>
						<Menu className="h-5 w-5" />
					</button>
				</div>
			</header>

			{/* Mobile Menu */}
			<MobileMenu
				items={items}
				activeItem={activeItem}
				isOpen={mobileMenuOpen}
				onClose={() => setMobileMenuOpen(false)}
			/>
		</>
	);
}

export default Topbar;

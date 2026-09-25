"use client";

import * as React from "react";
import { m, AnimatePresence } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { cn } from "../lib/utils";
import { durations, easings, springs } from "../lib/motion";

interface AccordionContextValue {
	expandedItems: string[];
	toggleItem: (value: string) => void;
	type: "single" | "multiple";
	glass: boolean;
}

const AccordionContext = React.createContext<AccordionContextValue | undefined>(undefined);

function useAccordionContext() {
	const context = React.useContext(AccordionContext);
	if (!context) {
		throw new Error("Accordion components must be used within an Accordion provider");
	}
	return context;
}

interface AccordionProps {
	type?: "single" | "multiple";
	defaultValue?: string | string[];
	children: React.ReactNode;
	className?: string;
	/** Enable frosted glass effect on items */
	glass?: boolean;
}

function Accordion({
	type = "single",
	defaultValue,
	children,
	className,
	glass = false,
}: AccordionProps) {
	const [expandedItems, setExpandedItems] = React.useState<string[]>(() => {
		if (!defaultValue) return [];
		return Array.isArray(defaultValue) ? defaultValue : [defaultValue];
	});

	const toggleItem = React.useCallback(
		(value: string) => {
			setExpandedItems((prev) => {
				if (type === "single") {
					return prev.includes(value) ? [] : [value];
				}
				return prev.includes(value)
					? prev.filter((item) => item !== value)
					: [...prev, value];
			});
		},
		[type]
	);

	return (
		<AccordionContext.Provider value={{ expandedItems, toggleItem, type, glass }}>
			<div className={cn(
				"w-full",
				glass ? "space-y-2" : "divide-y divide-mac-separator",
				className
			)}>
				{children}
			</div>
		</AccordionContext.Provider>
	);
}

interface AccordionItemProps {
	value: string;
	children: React.ReactNode;
	className?: string;
}

function AccordionItem({ value, children, className }: AccordionItemProps) {
	const { glass } = useAccordionContext();
	return (
		<div
			className={cn(
				"py-0",
				glass && "bg-mac-elevated backdrop-blur-sm border border-mac-separator rounded-xl px-4",
				className
			)}
			data-value={value}
		>
			{React.Children.map(children, (child) => {
				if (React.isValidElement(child)) {
					return React.cloneElement(child as React.ReactElement<{ itemValue?: string }>, { itemValue: value });
				}
				return child;
			})}
		</div>
	);
}

interface AccordionTriggerProps {
	children: React.ReactNode;
	className?: string;
	itemValue?: string;
}

function AccordionTrigger({ children, className, itemValue }: AccordionTriggerProps) {
	const { expandedItems, toggleItem } = useAccordionContext();
	const isExpanded = itemValue ? expandedItems.includes(itemValue) : false;

	return (
		<button
			type="button"
			onClick={() => itemValue && toggleItem(itemValue)}
			aria-expanded={isExpanded}
			className={cn(
				"flex w-full items-center justify-between py-4 text-sm font-medium text-foreground transition-all hover:text-mac-text-sec focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-500/50 rounded-lg",
				className
			)}
		>
			{children}
			<m.div
				animate={{ rotate: isExpanded ? 180 : 0 }}
				transition={{ duration: durations.base, ease: easings.easeOutExpo }}
			>
				<ChevronDown className="h-4 w-4 text-mac-text-sec" />
			</m.div>
		</button>
	);
}

interface AccordionContentProps {
	children: React.ReactNode;
	className?: string;
	itemValue?: string;
}

function AccordionContent({ children, className, itemValue }: AccordionContentProps) {
	const { expandedItems } = useAccordionContext();
	const isExpanded = itemValue ? expandedItems.includes(itemValue) : false;

	return (
		<AnimatePresence initial={false}>
			{isExpanded && (
				<m.div
					initial={{ height: 0, opacity: 0 }}
					animate={{
						height: "auto",
						opacity: 1,
						transition: springs.smooth,
					}}
					exit={{
						height: 0,
						opacity: 0,
						transition: { duration: durations.base, ease: easings.easeOutExpo },
					}}
					className="overflow-hidden"
				>
					<div className={cn("pb-4 text-sm text-mac-text-sec", className)}>
						{children}
					</div>
				</m.div>
			)}
		</AnimatePresence>
	);
}

export { Accordion, AccordionItem, AccordionTrigger, AccordionContent };

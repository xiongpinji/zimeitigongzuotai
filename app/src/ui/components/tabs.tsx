"use client";

import * as React from "react";
import { m } from "framer-motion";
import { cn } from "../lib/utils";
import { durations, easings, springs } from "../lib/motion";

interface TabsContextValue {
	value: string;
	onValueChange: (value: string) => void;
	glass: boolean;
}

const TabsContext = React.createContext<TabsContextValue | undefined>(undefined);

function useTabsContext() {
	const context = React.useContext(TabsContext);
	if (!context) {
		throw new Error("Tabs components must be used within a Tabs provider");
	}
	return context;
}

interface TabsProps {
	value: string;
	onValueChange: (value: string) => void;
	children: React.ReactNode;
	className?: string;
	/** Enable frosted glass effect on TabsList */
	glass?: boolean;
}

function Tabs({ value, onValueChange, children, className, glass = false }: TabsProps) {
	return (
		<TabsContext.Provider value={{ value, onValueChange, glass }}>
			<div className={cn("w-full", className)}>{children}</div>
		</TabsContext.Provider>
	);
}

interface TabsListProps {
	children: React.ReactNode;
	className?: string;
}

function TabsList({ children, className }: TabsListProps) {
	const { glass } = useTabsContext();
	return (
		<div
			role="tablist"
			className={cn(
				"inline-flex h-8 items-center justify-center rounded-lg border border-border bg-muted p-0.5 text-muted-foreground",
				className
			)}
		>
			{children}
		</div>
	);
}

interface TabsTriggerProps {
	value: string;
	children: React.ReactNode;
	className?: string;
	disabled?: boolean;
	/** Icon to display before the label */
	icon?: React.ReactNode;
}

function TabsTrigger({ value, children, className, disabled, icon }: TabsTriggerProps) {
	const { value: selectedValue, onValueChange } = useTabsContext();
	const isSelected = selectedValue === value;

	return (
		<button
			type="button"
			role="tab"
			aria-selected={isSelected}
			aria-controls={`tabpanel-${value}`}
			disabled={disabled}
			onClick={() => onValueChange(value)}
			className={cn(
				"relative inline-flex items-center justify-center whitespace-nowrap rounded-md px-2.5 py-1 text-[12px] font-medium transition-all outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-50",
				className
			)}
		>
			{isSelected && (
				<m.span
					layoutId="active-tab"
					className="absolute inset-0 rounded-md border border-border bg-background shadow-sm"
					transition={springs.swift}
				/>
			)}
			<span
				className={cn(
					"relative z-10 inline-flex items-center gap-2 transition-colors duration-200",
					isSelected ? "text-foreground" : "text-muted-foreground hover:text-foreground"
				)}
			>
				{icon && <span className="w-4 h-4 shrink-0 [&>svg]:w-full [&>svg]:h-full">{icon}</span>}
				{children}
			</span>
		</button>
	);
}

interface TabsContentProps {
	value: string;
	children: React.ReactNode;
	className?: string;
}

function TabsContent({ value, children, className }: TabsContentProps) {
	const { value: selectedValue } = useTabsContext();
	const isSelected = selectedValue === value;

	if (!isSelected) return null;

	return (
		<m.div
			id={`tabpanel-${value}`}
			role="tabpanel"
			aria-labelledby={`tab-${value}`}
			initial={{ opacity: 0, y: 8 }}
			animate={{ opacity: 1, y: 0 }}
			exit={{ opacity: 0, y: -4 }}
			transition={{ duration: durations.base, ease: easings.apple }}
			className={cn("mt-2 focus-visible:outline-none", className)}
		>
			{children}
		</m.div>
	);
}

export { Tabs, TabsList, TabsTrigger, TabsContent };

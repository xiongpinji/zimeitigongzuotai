"use client";

import { AlertTriangle, CheckCircle, Info, XCircle, X } from "lucide-react";
import React, { useEffect, useState } from "react";
import FocusLock from "react-focus-lock";
import { m, AnimatePresence } from "framer-motion";
import { springs } from "../lib/motion";
import { useOverlay } from "../contexts/overlay-context";
import { useEscapeKey } from "../hooks/use-escape-key";
import { Button } from "./button";
import { cn } from "../lib/utils";

export type AlertType = "info" | "success" | "warning" | "error";
export type AlertVariant = "info" | "success" | "warning" | "error" | "destructive";

// ============================================================================
// INLINE ALERT COMPONENT (Banner-style alerts)
// ============================================================================

interface InlineAlertProps {
	variant?: AlertVariant;
	title?: string;
	description?: string;
	children?: React.ReactNode;
	icon?: React.ReactNode;
	dismissible?: boolean;
	onDismiss?: () => void;
	className?: string;
	/** Enable frosted glass effect */
	glass?: boolean;
}

const alertVariants: Record<AlertVariant, { bg: string; border: string; icon: string; title: string; description: string }> = {
	info: {
		bg: "bg-mac-blue/[0.08]",
		border: "border-mac-blue/25",
		icon: "text-mac-blue-hover",
		title: "text-foreground",
		description: "text-mac-text-sec",
	},
	success: {
		bg: "bg-mac-green/[0.08]",
		border: "border-mac-green/25",
		icon: "text-mac-green",
		title: "text-foreground",
		description: "text-mac-text-sec",
	},
	warning: {
		bg: "bg-mac-orange/[0.08]",
		border: "border-mac-orange/25",
		icon: "text-mac-orange",
		title: "text-foreground",
		description: "text-mac-text-sec",
	},
	error: {
		bg: "bg-mac-red/[0.08]",
		border: "border-mac-red/25",
		icon: "text-mac-red",
		title: "text-foreground",
		description: "text-mac-text-sec",
	},
	destructive: {
		bg: "bg-mac-red/[0.08]",
		border: "border-mac-red/25",
		icon: "text-mac-red",
		title: "text-foreground",
		description: "text-mac-text-sec",
	},
};

const defaultIcons: Record<AlertVariant, React.ReactNode> = {
	info: <Info className="w-4 h-4" />,
	success: <CheckCircle className="w-4 h-4" />,
	warning: <AlertTriangle className="w-4 h-4" />,
	error: <XCircle className="w-4 h-4" />,
	destructive: <XCircle className="w-4 h-4" />,
};

export function Alert({
	variant = "info",
	title,
	description,
	children,
	icon,
	dismissible = false,
	onDismiss,
	className,
	glass: _glass = false,
}: InlineAlertProps) {
	const [isVisible, setIsVisible] = useState(true);
	const styles = alertVariants[variant];

	const handleDismiss = () => {
		setIsVisible(false);
		onDismiss?.();
	};

	return (
		<AnimatePresence>
			{isVisible && (
				<m.div
					initial={{ opacity: 0, y: -8, scale: 0.98 }}
					animate={{ opacity: 1, y: 0, scale: 1 }}
					exit={{ opacity: 0, y: -8, scale: 0.98 }}
					transition={springs.smooth}
					className={cn(
						"relative flex items-start gap-2.5 rounded-[10px] border py-3 px-3.5",
						cn(styles.bg, styles.border),
						className
					)}
					role="alert"
				>
					{/* Icon */}
					<div className={cn("shrink-0 mt-0.5", styles.icon)}>
						{icon || defaultIcons[variant]}
					</div>

					{/* Content */}
					<div className="flex-1 min-w-0">
						{title && (
							<h5 className={cn("text-sm font-semibold leading-tight", styles.title)}>
								{title}
							</h5>
						)}
						{description && (
							<p className={cn(
								"text-sm leading-relaxed",
								title ? "mt-1" : "",
								styles.description
							)}>
								{description}
							</p>
						)}
						{children}
					</div>

					{/* Dismiss button */}
					{dismissible && (
						<m.button
							type="button"
							onClick={handleDismiss}
							className={cn(
								"shrink-0 p-1 rounded-xl transition-colors",
								"hover:bg-accent active:bg-accent/80",
								styles.icon,
								"opacity-60 hover:opacity-100"
							)}
							whileHover={{ scale: 1.1 }}
							whileTap={{ scale: 0.9 }}
							aria-label="Dismiss alert"
						>
							<X className="w-4 h-4" />
						</m.button>
					)}
				</m.div>
			)}
		</AnimatePresence>
	);
}

// ============================================================================
// ALERT DIALOG COMPONENT (Modal-style alerts)
// ============================================================================

interface AlertProps {
	title: string;
	message: string;
	type?: AlertType;
	confirmText?: string;
	cancelText?: string;
	onConfirm?: () => void;
	onCancel?: () => void;
	showCancel?: boolean;
}

interface AlertContextValue {
	showAlert: (props: AlertProps) => void;
}

const AlertContext = React.createContext<AlertContextValue | undefined>(
	undefined,
);

export function useAlert() {
	const context = React.useContext(AlertContext);
	if (!context) {
		throw new Error("useAlert must be used within AlertProvider");
	}
	return context;
}

export function AlertProvider({ children }: { children: React.ReactNode }) {
	const [alert, setAlert] = useState<AlertProps | null>(null);
	const [isClosing, setIsClosing] = useState(false);
	const [overlayId, setOverlayId] = useState<string | null>(null);
	const { registerOverlay, unregisterOverlay } = useOverlay();

	const showAlert = (props: AlertProps) => {
		setAlert(props);
		setIsClosing(false);
	};

	const handleClose = (callback?: () => void) => {
		setIsClosing(true);
		setTimeout(() => {
			setAlert(null);
			setIsClosing(false);
			callback?.();
		}, 200);
	};

	// Register/unregister overlay when alert opens/closes
	useEffect(() => {
		if (alert && !overlayId) {
			const id = registerOverlay("alert", {
				blocksScroll: true,
				isFullscreen: false,
			});
			setOverlayId(id);
		} else if (!alert && overlayId) {
			unregisterOverlay(overlayId);
			setOverlayId(null);
		}
	}, [alert, overlayId, registerOverlay, unregisterOverlay]);

	// ESC key to close
	useEscapeKey(() => handleClose(alert?.onCancel), !!alert);

	const getIcon = (type: AlertType) => {
		const iconClass = "w-5 h-5";
		switch (type) {
			case "success":
				return <CheckCircle className={`${iconClass} text-mac-green`} />;
			case "warning":
				return <AlertTriangle className={`${iconClass} text-mac-orange`} />;
			case "error":
				return <XCircle className={`${iconClass} text-mac-red`} />;
			default:
				return <Info className={`${iconClass} text-mac-blue-hover`} />;
		}
	};

	return (
		<AlertContext.Provider value={{ showAlert }}>
			{children}
			{alert && (
				<FocusLock returnFocus>
					<div
						className={`fixed inset-0 flex items-center justify-center ${
							isClosing
								? "animate-out fade-out duration-200"
								: "animate-in fade-in duration-200"
						}`}
						style={{ zIndex: "var(--z-alert)" }}
					>
						<button
							type="button"
							className="absolute inset-0 bg-black/60"
							aria-label={alert.cancelText || "Dismiss alert"}
							onClick={() => handleClose(alert.onCancel)}
						/>
						<div
							className={`relative bg-mac-elevated shadow-[0_20px_60px_rgba(0,0,0,0.66)] border border-mac-border rounded-[14px] w-full max-w-md ${
								isClosing
									? "animate-out zoom-out-95 duration-200"
									: "animate-in zoom-in-95 duration-200"
							}`}
							role="alertdialog"
							aria-modal="true"
							aria-labelledby="alert-title"
							aria-describedby="alert-message"
						>
							<div className="p-6">
								<div className="flex items-start gap-3 mb-4">
									{getIcon(alert.type || "info")}
									<div className="flex-1">
										<h3
											id="alert-title"
											className="text-foreground text-base font-semibold mb-1"
										>
											{alert.title}
										</h3>
										<p id="alert-message" className="text-mac-text-sec text-sm">
											{alert.message}
										</p>
									</div>
								</div>
								<div className="flex justify-end gap-2">
									{alert.showCancel && (
										<Button
											variant="secondary"
											onClick={() => handleClose(alert.onCancel)}
										>
											{alert.cancelText || "Cancel"}
										</Button>
									)}
									<Button onClick={() => handleClose(alert.onConfirm)}>
										{alert.confirmText || "OK"}
									</Button>
								</div>
							</div>
						</div>
					</div>
				</FocusLock>
			)}
		</AlertContext.Provider>
	);
}

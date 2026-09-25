"use client";

import { AlertTriangle, CheckCircle, Info, X, XCircle } from "lucide-react";
import React, { useCallback, useState } from "react";
import { m, AnimatePresence } from "framer-motion";
import { springs, durations, easings } from "../lib/motion";

export type ToastType = "info" | "success" | "warning" | "error";

interface Toast {
	id: string;
	title?: string;
	message: string;
	type: ToastType;
	duration?: number;
	glass?: boolean;
}

interface ToastContextValue {
	showToast: (
		message: string,
		options?: {
			title?: string;
			type?: ToastType;
			duration?: number;
			/** Enable frosted glass effect */
			glass?: boolean;
		},
	) => void;
}

const ToastContext = React.createContext<ToastContextValue | undefined>(
	undefined,
);

export function useToast() {
	const context = React.useContext(ToastContext);
	if (!context) {
		throw new Error("useToast must be used within ToastProvider");
	}
	return context;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
	const [toasts, setToasts] = useState<Toast[]>([]);

	const removeToast = useCallback((id: string) => {
		setToasts((prev) => prev.filter((toast) => toast.id !== id));
	}, []);

	const showToast = useCallback(
		(
			message: string,
			options: {
				title?: string;
				type?: ToastType;
				duration?: number;
				glass?: boolean;
			} = {},
		) => {
			const id = Math.random().toString(36).substring(7);
			const toast: Toast = {
				id,
				message,
				title: options.title,
				type: options.type || "info",
				duration: options.duration || 3000,
				glass: options.glass || false,
			};

			setToasts((prev) => [...prev, toast]);

			const duration = toast.duration ?? 3000;
			if (duration > 0) {
				setTimeout(() => {
					removeToast(id);
				}, duration);
			}
		},
		[removeToast],
	);

	const getIcon = (type: ToastType) => {
		const iconClass = "w-4 h-4";
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
		<ToastContext.Provider value={{ showToast }}>
			{children}
			<div
				className="fixed top-4 right-4 flex flex-col gap-2 pointer-events-none"
				style={{ zIndex: "var(--z-toast)" }}
			>
				<AnimatePresence initial={false}>
					{toasts.map((toast) => (
						<m.div
							key={toast.id}
							layout
							initial={{ opacity: 0, x: 40, scale: 0.96 }}
							animate={{
								opacity: 1,
								x: 0,
								scale: 1,
								transition: springs.smooth,
							}}
							exit={{
								opacity: 0,
								x: 40,
								scale: 0.96,
								transition: { duration: durations.base, ease: easings.easeOutExpo },
							}}
							className="bg-mac-elevated shadow-[0_8px_24px_rgba(0,0,0,0.66)] border border-mac-border rounded-[10px] min-w-80 max-w-md pointer-events-auto"
						>
							<div className="p-4 flex items-start gap-3">
								{getIcon(toast.type)}
								<div className="flex-1 min-w-0">
									{toast.title && (
										<div className="text-foreground text-sm font-semibold mb-0.5">
											{toast.title}
										</div>
									)}
									<div className="text-mac-text-sec text-sm">{toast.message}</div>
								</div>
								<button
									type="button"
									onClick={() => removeToast(toast.id)}
									className="text-mac-text-muted hover:text-foreground transition-colors shrink-0"
									aria-label="Close"
								>
									<X className="w-4 h-4" />
								</button>
							</div>
						</m.div>
					))}
				</AnimatePresence>
			</div>
		</ToastContext.Provider>
	);
}

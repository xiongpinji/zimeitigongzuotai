"use client";

import type React from "react";
import { useEffect, useState } from "react";
import FocusLock from "react-focus-lock";
import { m, AnimatePresence } from "framer-motion";
import { modalBackdrop, sheetFromTop } from "../lib/motion";
import { useOverlay } from "../contexts/overlay-context";
import { useEscapeKey } from "../hooks/use-escape-key";
import { CloseButton } from "./close-button";

interface ModalProps {
	isOpen: boolean;
	onClose: () => void;
	title: string;
	children: React.ReactNode;
	className?: string;
	size?: "sm" | "md" | "lg" | "xl";
	/** Enable frosted glass effect */
	glass?: boolean;
}

export function Modal({
	isOpen,
	onClose,
	title,
	children,
	className = "",
	size = "md",
	glass = false,
}: ModalProps) {
	const [overlayId, setOverlayId] = useState<string | null>(null);
	const { registerOverlay, unregisterOverlay } = useOverlay();

	// Register/unregister overlay when modal opens/closes
	useEffect(() => {
		if (isOpen && !overlayId) {
			const id = registerOverlay("modal", {
				blocksScroll: true,
				isFullscreen: false,
			});
			setOverlayId(id);
		} else if (!isOpen && overlayId) {
			unregisterOverlay(overlayId);
			setOverlayId(null);
		}
	}, [isOpen, overlayId, registerOverlay, unregisterOverlay]);

	// ESC key to close
	useEscapeKey(onClose, isOpen);

	const sizeClasses = {
		sm: "max-w-md",
		md: "max-w-md",
		lg: "max-w-4xl",
		xl: "max-w-6xl",
	};

	return (
		<AnimatePresence>
			{isOpen && (
				<FocusLock returnFocus>
					<m.div
						variants={modalBackdrop}
						initial="hidden"
						animate="visible"
						exit="exit"
						className="fixed inset-0 bg-black/60 p-4 overflow-y-auto"
						style={{ zIndex: "var(--z-modal)" }}
						onClick={(e) => {
							if (e.target === e.currentTarget) {
								onClose();
							}
						}}
					>
						<div className="min-h-full flex items-center justify-center py-0 pointer-events-none">
							<m.div
								variants={sheetFromTop}
								initial="hidden"
								animate="visible"
								exit="exit"
								className={`bg-mac-elevated shadow-[0_20px_60px_rgba(0,0,0,0.66)] border border-mac-border rounded-[14px] w-full ${sizeClasses[size]} flex flex-col max-h-[calc(100vh-2rem)] ${className} pointer-events-auto`}
								role="dialog"
								aria-modal="true"
								aria-labelledby="modal-title"
							>
								<div className="flex items-center justify-start px-6 py-4 border-b border-mac-separator relative shrink-0">
									<CloseButton onClick={onClose} />
									<div
										id="modal-title"
										className="text-foreground text-sm font-semibold ml-2"
									>
										{title}
									</div>
								</div>
								<div className="p-4 overflow-y-auto">{children}</div>
							</m.div>
						</div>
					</m.div>
				</FocusLock>
			)}
		</AnimatePresence>
	);
}

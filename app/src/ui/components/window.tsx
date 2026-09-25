import type React from "react";
import { CloseButton } from "./close-button";
import { m } from "framer-motion";

interface WindowProps {
	children: React.ReactNode;
	title: string;
	/** Enable frosted glass effect */
	glass?: boolean;
}

export function Window({ children, title, glass = false }: WindowProps) {
	return (
		<m.div
			initial={{ opacity: 0, scale: 0.98 }}
			animate={{ opacity: 1, scale: 1 }}
			transition={{ duration: 0.4, ease: "easeOut" }}
			className={`flex h-full w-full flex-col rounded-(--radius-lg,0.75rem) border shadow-lg ${
				glass
					? "bg-mac-elevated backdrop-blur-xl border-mac-separator"
					: "bg-mac-elevated backdrop-blur-md border-mac-separator"
			}`}
		>
			<div className="relative flex items-center justify-center border-b border-mac-separator px-4 py-1.5 bg-mac-control rounded-t-(--radius-lg,0.75rem)">
				<CloseButton
					href="/"
					className="absolute left-4 top-1/2 -translate-y-1/2"
				/>
				<div className="text-xs font-medium text-mac-text-sec tracking-wide">
					{title}
				</div>
			</div>
			<div className="flex-1 overflow-hidden flex flex-col relative">
				<m.div
					initial={{ opacity: 0, y: 20 }}
					animate={{ opacity: 1, y: 0 }}
					transition={{ delay: 0.1, duration: 0.4 }}
					className="h-full flex flex-col"
				>
					{children}
				</m.div>
			</div>
		</m.div>
	);
}

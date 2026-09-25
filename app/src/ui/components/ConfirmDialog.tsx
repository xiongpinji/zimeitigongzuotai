"use client";

import * as React from "react";
import { Button } from "./button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "./dialog";

type ConfirmVariant = "primary" | "secondary" | "destructive";

interface ConfirmDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	title: React.ReactNode;
	description?: React.ReactNode;
	confirmText?: string;
	cancelText?: string;
	showCancel?: boolean;
	confirmVariant?: ConfirmVariant;
	onConfirm?: () => void | Promise<void>;
	onCancel?: () => void;
}

const variantMap: Record<ConfirmVariant, "primary" | "secondary" | "destructive"> = {
	primary: "primary",
	secondary: "secondary",
	destructive: "destructive",
};

export function ConfirmDialog({
	open,
	onOpenChange,
	title,
	description,
	confirmText = "确认",
	cancelText = "取消",
	showCancel = true,
	confirmVariant = "primary",
	onConfirm,
	onCancel,
}: ConfirmDialogProps) {
	const [isConfirming, setIsConfirming] = React.useState(false);
	const skipCancelRef = React.useRef(false);

	const handleCancel = React.useCallback(() => {
		if (isConfirming) {
			return;
		}
		onCancel?.();
		onOpenChange(false);
	}, [isConfirming, onCancel, onOpenChange]);

	const handleConfirm = React.useCallback(async () => {
		try {
			const result = onConfirm?.();
			if (result && typeof (result as Promise<void>).then === "function") {
				setIsConfirming(true);
				await result;
			}
			skipCancelRef.current = true;
			onOpenChange(false);
		} catch (error) {
			// 交给调用方处理业务异常，组件只保证状态恢复
			console.error("ConfirmDialog confirm action failed:", error);
		} finally {
			setIsConfirming(false);
		}
	}, [onConfirm, onOpenChange]);

	return (
		<Dialog
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) {
					if (skipCancelRef.current) {
						skipCancelRef.current = false;
						onOpenChange(false);
						return;
					}
					handleCancel();
					return;
				}
				onOpenChange(true);
			}}
		>
			<DialogContent size="sm">
				<DialogHeader>
					<DialogTitle>{title}</DialogTitle>
					{description ? <DialogDescription>{description}</DialogDescription> : null}
				</DialogHeader>
				<DialogFooter>
					{showCancel ? (
						<Button
							variant="ghost"
							onClick={handleCancel}
							disabled={isConfirming}
						>
							{cancelText}
						</Button>
					) : null}
					<Button
						variant={variantMap[confirmVariant]}
						onClick={() => {
							void handleConfirm();
						}}
						loading={isConfirming}
					>
						{confirmText}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

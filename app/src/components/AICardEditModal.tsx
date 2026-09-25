import type { AICard } from "../types/ai";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../ui";
import { AICardInspector } from "./AICardInspector";
import styles from "./AICardEditModal.module.css";

interface AICardEditModalProps {
  visible: boolean;
  card: AICard | null;
  isRegenerating?: boolean;
  previewWidth?: number;
  previewHeight?: number;
  onClose: () => void;
  onRegenerate: (updates: Partial<AICard>) => Promise<AICard | null>;
  onSave: (cardId: string, updates: Partial<AICard>) => void;
}

export function AICardEditModal({
  visible,
  card,
  isRegenerating = false,
  previewWidth = 1_920,
  previewHeight = 1_080,
  onClose,
  onRegenerate,
  onSave,
}: AICardEditModalProps) {
  if (!visible || !card) {
    return null;
  }

  return (
    <Dialog open={visible} onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg">
        <DialogHeader>
          <div className={styles.eyebrow}>EDIT CARD</div>
          <DialogTitle>编辑卡片</DialogTitle>
        </DialogHeader>
        <DialogBody>
          <AICardInspector
            card={card}
            isRegenerating={isRegenerating}
            previewWidth={previewWidth}
            previewHeight={previewHeight}
            showCancel
            onCancel={onClose}
            onRegenerate={onRegenerate}
            onSave={(cardId, updates) => {
              onSave(cardId, updates);
              onClose();
            }}
          />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

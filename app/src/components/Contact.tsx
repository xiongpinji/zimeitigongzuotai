import { MessageCircle } from 'lucide-react';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui';
import authorQr from '../assets/contact-author-qr.png';
import groupQr from '../assets/contact-group-qr.jpg';

const WECHAT_ID = 'yoqu2020';

const QRS = [
  { key: 'group', label: '微信群交流', src: groupQr },
  { key: 'author', label: '作者微信', src: authorQr },
] as const;

/** 联系方式卡片：欢迎页弹窗与设置页 Tab 共用 */
export function ContactCards() {
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="text-sm text-muted-foreground">
        微信号：<span className="font-medium text-foreground">{WECHAT_ID}</span>
      </div>
      <div className="flex flex-wrap justify-center gap-5">
        {QRS.map((q) => (
          <div
            key={q.key}
            className="flex w-44 flex-col items-center gap-3 rounded-[14px] border border-mac-border bg-mac-elevated p-4"
          >
            <span className="text-sm font-medium text-foreground">{q.label}</span>
            <img
              src={q.src}
              alt={q.label}
              className="w-full rounded-lg bg-white object-contain p-1"
            />
          </div>
        ))}
      </div>
    </div>
  );
}

interface ContactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 联系作者弹窗 */
export function ContactDialog({ open, onOpenChange }: ContactDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogClose />
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageCircle className="h-4 w-4 text-mac-blue" />
            联系作者
          </DialogTitle>
          <DialogDescription>
            扫码加入灵机剪影微信群交流使用体验与建议，也可以通过作者微信直接联系我。
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <ContactCards />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

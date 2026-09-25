import { Heart } from 'lucide-react';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../ui';
import wechatQr from '../assets/donate-wechat.jpg';
import alipayQr from '../assets/donate-alipay.jpg';

const CHANNELS = [
  { key: 'wechat', label: '微信支付', src: wechatQr, accent: '#07c160' },
  { key: 'alipay', label: '支付宝', src: alipayQr, accent: '#1677ff' },
] as const;

/** 收款码卡片：欢迎页弹窗与设置页 Tab 共用 */
export function DonateCards() {
  return (
    <div className="flex flex-wrap justify-center gap-5">
      {CHANNELS.map((c) => (
        <div
          key={c.key}
          className="flex w-44 flex-col items-center gap-3 rounded-[14px] border border-mac-border bg-mac-elevated p-4"
        >
          <span className="text-sm font-medium" style={{ color: c.accent }}>
            {c.label}
          </span>
          <img
            src={c.src}
            alt={`${c.label}收款码`}
            className="w-full rounded-lg bg-white object-contain p-1"
          />
        </div>
      ))}
    </div>
  );
}

interface DonateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 打赏弹窗 */
export function DonateDialog({ open, onOpenChange }: DonateDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogClose />
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Heart className="h-4 w-4 text-mac-blue" />
            支持作者
          </DialogTitle>
          <DialogDescription>
            灵机剪影是免费开源项目，如果它帮到了你，欢迎请作者喝杯咖啡 ☕
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <DonateCards />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

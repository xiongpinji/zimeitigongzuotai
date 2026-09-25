import { Check } from 'lucide-react';
import { Button } from '../components/button';

export interface SaveButtonProps {
  onClick: () => void;
  saved?: boolean;
  saving?: boolean;
  defaultLabel?: string;
  savedLabel?: string;
  savingLabel?: string;
  disabled?: boolean;
  className?: string;
}

export function SaveButton({
  className,
  defaultLabel = '保存配置',
  disabled = false,
  onClick,
  saved = false,
  savedLabel = '已保存',
  saving = false,
  savingLabel = '保存中...',
}: SaveButtonProps) {
  const label = saving ? savingLabel : saved ? savedLabel : defaultLabel;

  return (
    <Button
      type="button"
      variant={saved ? 'success' : 'primary'}
      loading={saving}
      disabled={disabled}
      onClick={onClick}
      leftIcon={saved ? <Check /> : undefined}
      className={className}
    >
      {label}
    </Button>
  );
}

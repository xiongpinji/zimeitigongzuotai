import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../ui';
import styles from './ConflictDialog.module.css';

type ConflictResolution = 'mine' | 'external';

interface ConflictDialogProps {
  open: boolean;
  files: string[];
  resolutions: Record<string, ConflictResolution>;
  onChangeResolution: (file: string, resolution: ConflictResolution) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConflictDialog({
  open,
  files,
  resolutions,
  onChangeResolution,
  onCancel,
  onConfirm,
}: ConflictDialogProps) {
  if (!open || !files.length) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
      <DialogContent size="lg" className={styles.dialog}>
        <DialogHeader>
          <DialogTitle>检测到外部文件冲突</DialogTitle>
          <DialogDescription>
            这些文件在你编辑期间被外部修改了。保存前请决定保留当前版本还是使用外部版本。
          </DialogDescription>
        </DialogHeader>

        <DialogBody className={styles.body}>
          <div className={styles.list}>
            {files.map((file) => {
              const resolution = resolutions[file];
              return (
                <div key={file} className={styles.item}>
                  <div className={styles.fileName} title={file}>
                    {file}
                  </div>
                  <div className={styles.actions}>
                    <Button
                      type="button"
                      size="sm"
                      variant={resolution === 'mine' ? 'accent' : 'outline'}
                      className={styles.choiceButton}
                      onClick={() => onChangeResolution(file, 'mine')}
                    >
                      使用我的版本
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={resolution === 'external' ? 'accent' : 'outline'}
                      className={styles.choiceButton}
                      onClick={() => onChangeResolution(file, 'external')}
                    >
                      使用外部版本
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </DialogBody>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            取消
          </Button>
          <Button type="button" variant="primary" onClick={onConfirm}>
            确认保存
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

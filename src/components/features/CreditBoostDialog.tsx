import { CreditsBoostDialog } from './CreditsBoostDialog';

type TargetType = 'post' | 'profile';

export function CreditBoostDialog({
  open,
  onOpenChange,
  targetType,
  targetId,
  title,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetType: TargetType;
  targetId: string;
  title?: string;
}) {
  return (
    <CreditsBoostDialog
      sourceType={targetType}
      sourceId={targetId}
      open={open}
      onOpenChange={onOpenChange}
      onSuccess={() => undefined}
    />
  );
}

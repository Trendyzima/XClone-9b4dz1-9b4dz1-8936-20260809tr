import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Coins } from 'lucide-react';

type SourceType = 'post' | 'profile';
interface CreditsBoostDialogProps {
  sourceType: SourceType;
  sourceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

export function CreditsBoostDialog({ open, onOpenChange }: CreditsBoostDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Coins className="w-5 h-5 text-primary" />Credits boost unavailable</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          Credits boosts remain disabled until the Backend owns the credits balance, debit, idempotency and boost-delivery contracts. No credits have been deducted.
        </p>
      </DialogContent>
    </Dialog>
  );
}

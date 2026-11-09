import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { TrendingUp } from 'lucide-react';

interface BoostPostDialogProps { open: boolean; onOpenChange: (open: boolean) => void; postId: string; }

export function BoostPostDialog({ open, onOpenChange }: BoostPostDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><TrendingUp className="w-5 h-5 text-primary" />Boost Your Post</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">
          Post promotions are temporarily unavailable while the Testagram Backend ads and credits-ledger APIs are being migrated. No wallet or credit balance has been charged.
        </p>
      </DialogContent>
    </Dialog>
  );
}

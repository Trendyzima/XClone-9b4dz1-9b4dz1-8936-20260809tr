import { ReactNode, useState } from 'react';
import { X } from 'lucide-react';
import { TestagramAdSlot } from './TestagramAdSlot';

interface NativeAdCardProps {
  onClose?: () => void;
  className?: string;
}

/** Compatibility wrapper: native feed inventory is now served only by Testagram Ads. */
export function NativeAdCard({ onClose, className = '' }: NativeAdCardProps) {
  const [visible, setVisible] = useState(true);
  if (!visible) return null;
  return (
    <div className={`relative ${className}`}>
      <TestagramAdSlot placement="HOME_FEED" />
      {onClose && (
        <button type="button" aria-label="Hide ad" onClick={() => { setVisible(false); onClose(); }} className="absolute right-2 top-2 z-10 w-7 h-7 rounded-full bg-background/80 border border-border flex items-center justify-center">
          <X className="w-4 h-4" />
        </button>
      )}
    </div>
  );
}

/** Preserve the feed injection API while routing every inserted ad through Testagram Ads. */
export function injectNativeAds<T>(items: T[], renderItem: (item: T, index: number) => ReactNode, interval = 12): ReactNode[] {
  const result: ReactNode[] = [];
  items.forEach((item, i) => {
    result.push(renderItem(item, i));
    if ((i + 1) % interval === 0 && i < items.length - 1) result.push(<NativeAdCard key={`native-ad-${i}`} className="mx-0 my-0" />);
  });
  return result;
}

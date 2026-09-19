import { Check } from 'lucide-react';

type VerifiedTickProps = {
  className?: string;
  title?: string;
};

/**
 * Testagram's canonical verification mark: a standalone blue tick.
 * No circular badge/container is rendered.
 */
export function VerifiedTick({ className = 'w-4 h-4', title = 'Verified account' }: VerifiedTickProps) {
  return (
    <span
      role="img"
      aria-label={title}
      title={title}
      className={`inline-flex items-center justify-center shrink-0 text-primary ${className}`}
    >
      <Check aria-hidden="true" strokeWidth={3} className="w-full h-full" />
    </span>
  );
}

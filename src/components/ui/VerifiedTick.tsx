import { cn } from '@/lib/utils';

type VerifiedTickProps = {
  className?: string;
  title?: string;
};

/**
 * Testagram's canonical verification mark.
 *
 * Deliberately not a circular badge: a refined two-tone check with a
 * white optical keyline and blue face. The keyline keeps it crisp over
 * avatars, gradients and dark surfaces without becoming a badge.
 */
export function VerifiedTick({
  className,
  title = 'Verified account',
}: VerifiedTickProps) {
  return (
    <span
      role="img"
      aria-label={title}
      title={title}
      className={cn(
        'inline-flex size-[1.05em] shrink-0 align-[-0.14em] select-none',
        'drop-shadow-[0_1px_2px_rgba(15,23,42,0.18)]',
        className,
      )}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        className="size-full overflow-visible"
      >
        <defs>
          <linearGradient
            id="testagram-verified-blue"
            x1="5"
            y1="19"
            x2="20"
            y2="5"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="hsl(var(--primary))" />
            <stop offset="1" stopColor="#38bdf8" />
          </linearGradient>
        </defs>

        <path
          d="M5.25 12.55 9.65 17l9.1-10"
          stroke="white"
          strokeWidth="5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M5.25 12.55 9.65 17l9.1-10"
          stroke="url(#testagram-verified-blue)"
          strokeWidth="3.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

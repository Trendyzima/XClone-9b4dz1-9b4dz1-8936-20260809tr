import { cn } from '@/lib/utils';

type VerifiedTickProps = {
  className?: string;
  title?: string;
};

/**
 * Testagram's canonical verification mark.
 *
 * A premium circular verification badge: a blue gradient disc with
 * a crisp white optical ring and a polished blue check. It keeps the
 * familiar social-verification silhouette while remaining lightweight.
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
        'inline-flex size-[1.12em] shrink-0 align-[-0.16em] select-none',
        'drop-shadow-[0_1px_2px_rgba(15,23,42,0.2)]',
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
            id="testagram-verified-ring"
            x1="4"
            y1="20"
            x2="20"
            y2="4"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="#0b63f6" />
            <stop offset="0.55" stopColor="hsl(var(--primary))" />
            <stop offset="1" stopColor="#60a5fa" />
          </linearGradient>

          <linearGradient
            id="testagram-verified-check"
            x1="7"
            y1="18"
            x2="17"
            y2="7"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="1" stopColor="#eaf4ff" />
          </linearGradient>
        </defs>

        {/* Gradient circular field. */}
        <circle
          cx="12"
          cy="12"
          r="10.35"
          fill="url(#testagram-verified-ring)"
        />

        {/* Fine inner highlight gives the circle depth without a bulky badge. */}
        <circle
          cx="12"
          cy="12"
          r="9.15"
          stroke="rgba(255,255,255,0.28)"
          strokeWidth="0.9"
        />

        {/* Clean white verification tick, optically centered inside the disc. */}
        <path
          d="M7.05 12.25 10.45 15.65 17.15 8.35"
          stroke="url(#testagram-verified-check)"
          strokeWidth="2.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

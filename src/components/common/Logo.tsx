import { useId, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Drop your own mark at `public/logo.png` (or `public/logo.svg`) to replace the
 * built-in gradient icon. The fallback stays visible until a file is present.
 */
const LOGO_CANDIDATES = ["/logo.svg", "/logo.png"] as const;

function FallbackMark({ className }: { className?: string }) {
  const gradientId = `lp-mark-${useId().replace(/:/g, "")}`;
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("size-9 shrink-0", className)}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#00F5D4" />
          <stop offset="1" stopColor="#7B61FF" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="10" fill={`url(#${gradientId})`} />
      <path
        d="M9.8 13.6h12.4l-1.25 9.3a2.1 2.1 0 0 1-2.08 1.82h-5.74a2.1 2.1 0 0 1-2.08-1.82L9.8 13.6Z"
        fill="#0B0B10"
        fillOpacity="0.9"
      />
      <path
        d="M12.6 13.4a3.4 3.4 0 0 1 6.8 0"
        stroke="#0B0B10"
        strokeWidth="1.7"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="16" cy="19.6" r="1.35" fill="#00F5D4" />
    </svg>
  );
}

export function LogoMark({ className }: { className?: string }) {
  const [candidate, setCandidate] = useState(0);

  if (candidate >= LOGO_CANDIDATES.length) return <FallbackMark className={className} />;

  return (
    <img
      src={LOGO_CANDIDATES[candidate]}
      alt=""
      aria-hidden="true"
      decoding="async"
      className={cn("size-9 shrink-0 rounded-[10px] object-contain", className)}
      onError={() => setCandidate((current) => current + 1)}
    />
  );
}

export function Logo({
  className,
  showText = true,
}: {
  className?: string;
  showText?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      {showText ? (
        <span className="flex flex-col justify-center leading-none">
          <span className="font-heading text-[1.02rem] font-bold tracking-tight text-foreground">
            লুটপাট <span className="accent-ink">বাজার</span>
          </span>
          <span className="mt-1 text-[0.56rem] font-medium uppercase tracking-[0.28em] text-muted-foreground">
            LootPat Bazar
          </span>
        </span>
      ) : null}
    </span>
  );
}

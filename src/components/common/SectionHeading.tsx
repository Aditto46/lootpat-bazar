import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Eyebrow({
  children,
  className,
  tone,
}: {
  children: ReactNode;
  className?: string;
  tone?: string;
}) {
  return (
    <p
      className={cn(
        "inline-flex items-center gap-2 text-[0.7rem] font-semibold uppercase tracking-[0.26em] text-[var(--accent-ink)]",
        className,
      )}
      style={tone ? { color: tone } : undefined}
    >
      <span
        aria-hidden="true"
        className="h-px w-6 bg-gradient-to-r from-[var(--brand-teal)] to-transparent"
      />
      {children}
    </p>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  body,
  action,
  id,
}: {
  eyebrow: string;
  title: string;
  body?: string;
  action?: ReactNode;
  id?: string;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-5 sm:mb-11">
      <div className="max-w-2xl">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h2 id={id} className="mt-3 text-2xl font-bold sm:text-3xl lg:text-4xl">
          {title}
        </h2>
        {body ? (
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground sm:text-base">
            {body}
          </p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

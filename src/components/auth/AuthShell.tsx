import { ArrowLeft, Eye, EyeOff, ShieldCheck, Truck, Undo2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link } from "../../lib/router";
import { cn } from "@/lib/utils";
import { useI18n } from "../../lib/i18n";

export const fieldClass =
  "h-11 w-full rounded-xl border border-[var(--site-border)] bg-[var(--surface-sunken)] px-3.5 text-sm text-foreground outline-none transition placeholder:text-muted-foreground/70 focus:border-[var(--site-accent)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--site-accent)_32%,transparent)] disabled:opacity-60";

export const labelClass = "text-sm font-medium text-foreground";

export const primaryButtonClass =
  "inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[var(--site-accent)] px-5 text-sm font-semibold text-[var(--site-on-accent)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60";

export const secondaryButtonClass =
  "inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-[var(--site-border)] bg-transparent px-4 text-sm font-semibold text-foreground transition hover:border-[var(--accent-ink)] hover:text-[var(--accent-ink)] disabled:cursor-not-allowed disabled:opacity-60";

export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <label htmlFor={id} className={labelClass}>
        {label}
      </label>
      {children}
      {hint && !error ? (
        <p id={`${id}-hint`} className="text-xs leading-relaxed text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-[var(--danger-ink)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function FormAlert({ message }: { message: string }) {
  return (
    <p
      role="alert"
      className="rounded-xl border border-[color-mix(in_srgb,var(--danger-ink)_45%,transparent)] bg-[color-mix(in_srgb,var(--danger-ink)_10%,transparent)] px-3.5 py-2.5 text-sm text-[var(--danger-ink)]"
    >
      {message}
    </p>
  );
}

export function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  hint,
  error,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  hint?: string;
  error?: string;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);

  return (
    <Field id={id} label={label} hint={hint} error={error}>
      <div className="relative">
        <input
          id={id}
          type={visible ? "text" : "password"}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          autoComplete={autoComplete}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
          className={cn(fieldClass, "pr-12")}
        />
        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={t(visible ? "auth.hidePassword" : "auth.showPassword")}
          aria-pressed={visible}
          className="absolute right-1 top-1 grid size-9 place-items-center rounded-lg text-muted-foreground transition hover:bg-[var(--surface-raised)] hover:text-foreground"
        >
          {visible ? (
            <EyeOff aria-hidden="true" className="size-4" />
          ) : (
            <Eye aria-hidden="true" className="size-4" />
          )}
        </button>
      </div>
    </Field>
  );
}

export function PageLoading({ label }: { label: string }) {
  return (
    <div className="container-page flex min-h-[52vh] items-center justify-center py-20">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span
          aria-hidden="true"
          className="size-4 animate-spin rounded-full border-2 border-[var(--site-border)] border-t-[var(--site-accent)]"
        />
        {label}
      </div>
    </div>
  );
}

export function AuthShell({
  eyebrow,
  title,
  body,
  children,
}: {
  eyebrow: string;
  title: string;
  body: string;
  children: ReactNode;
}) {
  const { t } = useI18n();

  return (
    <div className="relative overflow-hidden pb-20 pt-8 sm:pt-12">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-28 h-80 bg-[radial-gradient(60%_100%_at_50%_0%,color-mix(in_srgb,var(--site-accent)_16%,transparent),transparent_70%)]"
      />
      <div className="container-page relative">
        <Link
          to="/"
          className="inline-flex items-center gap-2 rounded-full text-sm text-muted-foreground transition hover:text-foreground"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          {t("auth.backHome")}
        </Link>

        <div className="mt-7 grid items-start gap-10 lg:grid-cols-[0.92fr_1.08fr] lg:gap-16">
          <div className="max-w-xl lg:sticky lg:top-28">
            <p className="inline-flex items-center gap-2 text-[0.7rem] font-semibold uppercase tracking-[0.26em] text-[var(--accent-ink)]">
              <span aria-hidden="true" className="h-px w-6 bg-gradient-to-r from-[var(--brand-teal)] to-transparent" />
              {eyebrow}
            </p>
            <h1 className="mt-3 text-3xl font-bold leading-tight sm:text-4xl">{title}</h1>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground sm:text-base">{body}</p>

            <ul className="mt-9 grid gap-3.5 text-sm text-muted-foreground">
              <li className="flex items-start gap-3">
                <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-[var(--accent-ink)]" />
                <span>{t("auth.serverNote")}</span>
              </li>
              <li className="flex items-start gap-3">
                <Truck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-[var(--accent-ink)]" />
                <span>{t("trust.deliveryBody")}</span>
              </li>
              <li className="flex items-start gap-3">
                <Undo2 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-[var(--accent-ink)]" />
                <span>{t("trust.returnBody")}</span>
              </li>
            </ul>
          </div>

          <div className={cn("glass relative rounded-[var(--radius-card)] p-5 sm:p-7")}>{children}</div>
        </div>
      </div>
    </div>
  );
}

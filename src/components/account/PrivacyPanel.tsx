import { Download, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Field, FormAlert, fieldClass, primaryButtonClass, secondaryButtonClass } from "../auth/AuthShell";
import { useAuth } from "../../lib/auth";
import { authErrorKey } from "../../lib/authError";
import { useI18n } from "../../lib/i18n";
import { Link } from "../../lib/router";
import { deleteMyAccount, exportMyData } from "../../lib/security";
import { cn } from "@/lib/utils";

export function PrivacyPanel() {
  const { t } = useI18n();
  const { user, refresh } = useAuth();
  const isCustomer = user?.role.id === "customer";

  const [exporting, setExporting] = useState(false);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onExport() {
    setExporting(true);
    try {
      await exportMyData();
    } catch (cause) {
      toast.error(t(authErrorKey(cause)));
    } finally {
      setExporting(false);
    }
  }

  async function onDelete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (confirm !== "DELETE") {
      setError(t("account.confirmMismatch"));
      return;
    }
    setBusy(true);
    try {
      await deleteMyAccount(password, "DELETE");
      toast.success(t("account.deleteDone"));
      setOpen(false);
      await refresh();
    } catch (cause) {
      setError(t(authErrorKey(cause)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="glass rounded-[var(--radius-card)] p-5 sm:p-7">
      <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
        <ShieldCheck aria-hidden="true" className="size-4 text-[var(--accent-ink)]" />
        {t("account.privacyTitle")}
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        {t("account.privacyBody")}
      </p>

      <dl className="mt-5 space-y-2.5 border-t border-[var(--site-border)] pt-4 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">{t("auth.twoFactorBadge")}</dt>
          <dd
            className={cn(
              "font-semibold",
              user?.twoFactor.enabled ? "text-[var(--accent-ink)]" : "text-muted-foreground",
            )}
          >
            {t(user?.twoFactor.enabled ? "auth.twoFactorOn" : "auth.twoFactorOff")}
          </dd>
        </div>
      </dl>

      <div className="mt-5 flex flex-wrap gap-2.5">
        <button
          type="button"
          onClick={() => void onExport()}
          disabled={exporting}
          className={cn(secondaryButtonClass, "h-9 px-3 text-xs")}
        >
          {exporting ? (
            <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
          ) : (
            <Download aria-hidden="true" className="size-3.5" />
          )}
          {t("account.exportData")}
        </button>
        <Link to="/privacy" className={cn(secondaryButtonClass, "h-9 px-3 text-xs")}>
          {t("account.privacyLink")}
        </Link>
        {isCustomer ? (
          <button
            type="button"
            onClick={() => {
              setPassword("");
              setConfirm("");
              setError(null);
              setOpen(true);
            }}
            className="inline-flex h-9 items-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--danger-ink)_45%,transparent)] px-3 text-xs font-semibold text-[var(--danger-ink)] transition hover:bg-[color-mix(in_srgb,var(--danger-ink)_10%,transparent)]"
          >
            <Trash2 aria-hidden="true" className="size-3.5" />
            {t("account.deleteAccount")}
          </button>
        ) : (
          <p className="w-full text-xs leading-relaxed text-muted-foreground">
            {t("account.staffDeleteNote")}
          </p>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogTitle className="font-heading text-lg font-bold">
            {t("account.deleteTitle")}
          </DialogTitle>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t("account.deleteBody")}
          </p>
          <form className="mt-2 space-y-3" onSubmit={onDelete} noValidate>
            <Field id="delete-password" label={t("auth.password")}>
              <input
                id="delete-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={busy}
                className={fieldClass}
              />
            </Field>
            <Field id="delete-confirm" label={t("account.deleteConfirmLabel")}>
              <input
                id="delete-confirm"
                type="text"
                autoComplete="off"
                required
                value={confirm}
                onChange={(event) => setConfirm(event.target.value.toUpperCase())}
                placeholder="DELETE"
                disabled={busy}
                className={fieldClass}
              />
            </Field>
            {error ? <FormAlert message={error} /> : null}
            <button type="submit" disabled={busy} className={primaryButtonClass}>
              {busy ? (
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <Trash2 aria-hidden="true" className="size-4" />
              )}
              {t("account.deleteCta")}
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

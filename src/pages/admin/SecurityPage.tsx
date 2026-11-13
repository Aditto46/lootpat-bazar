import {
  CheckCircle2,
  Database,
  Download,
  FileJson,
  KeyRound,
  Loader2,
  Network,
  RefreshCw,
  ShieldCheck,
  ShieldOff,
  Smartphone,
} from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import {
  Field,
  FormAlert,
  PasswordField,
  fieldClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../../components/auth/AuthShell";
import { loadAdminSettings, saveAdminSettings } from "../../lib/admin";
import { useAuth } from "../../lib/auth";
import { authErrorKey } from "../../lib/authError";
import { formatDateTime, formatNumber, useI18n } from "../../lib/i18n";
import {
  changePassword,
  createBackup,
  disableTwoFactor,
  downloadAuditExport,
  downloadBackup,
  enableTwoFactor,
  loadBackups,
  loadTwoFactorStatus,
  regenerateRecoveryCodes,
  startTwoFactorSetup,
  type BackupSummary,
  type TwoFactorSetup,
  type TwoFactorStatus,
} from "../../lib/security";
import { cn } from "@/lib/utils";
import { AdminShell, Panel } from "./AdminShell";

type FactorDraft = { password: string; code: string };

const emptyFactor: FactorDraft = { password: "", code: "" };

function CodeList({ codes }: { codes: string[] }) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl border border-[var(--site-border)] bg-[var(--surface-sunken)] p-3 font-mono text-xs text-foreground sm:grid-cols-2">
      {codes.map((code) => (
        <span key={code} dir="ltr">
          {code}
        </span>
      ))}
    </div>
  );
}

function isCode(value: string): boolean {
  return /^\d{6}$/.test(value);
}

export function SecurityPage() {
  const { t, lang } = useI18n();
  const { user, hasPermission, refresh } = useAuth();
  const isOwner = user?.role.id === "owner" && Boolean(user.role.is_staff);
  const canBackup = isOwner && hasPermission("data.export");
  const canAudit = isOwner && hasPermission("audit.read");

  const [factor, setFactor] = useState<TwoFactorStatus | null>(null);
  const [factorError, setFactorError] = useState<string | null>(null);
  const [setup, setSetup] = useState<TwoFactorSetup | null>(null);
  const [setupPassword, setSetupPassword] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [setupBusy, setSetupBusy] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);

  const [regen, setRegen] = useState<FactorDraft | null>(null);
  const [disable, setDisable] = useState<FactorDraft | null>(null);
  const [factorBusy, setFactorBusy] = useState(false);

  const [password, setPassword] = useState({ current: "", next: "", confirm: "" });
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordBusy, setPasswordBusy] = useState(false);

  const [backups, setBackups] = useState<BackupSummary[] | null>(null);
  const [backupError, setBackupError] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);
  const [downloading, setDownloading] = useState<string | null>(null);

  const [allowlist, setAllowlist] = useState("");
  const [allowlistLoaded, setAllowlistLoaded] = useState(false);
  const [allowlistBusy, setAllowlistBusy] = useState(false);
  const [allowlistError, setAllowlistError] = useState<string | null>(null);

  const loadFactor = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const result = await loadTwoFactorStatus(signal);
        setFactor(result);
        setFactorError(null);
      } catch (error) {
        if (signal?.aborted) return;
        setFactorError(t(authErrorKey(error)));
      }
    },
    [t],
  );

  useEffect(() => {
    if (!user?.role.is_staff) return;
    const controller = new AbortController();
    void loadFactor(controller.signal);
    return () => controller.abort();
  }, [user, loadFactor]);

  useEffect(() => {
    if (!canBackup) return;
    let active = true;
    loadBackups()
      .then((result) => {
        if (active) {
          setBackups(result.backups);
          setBackupError(null);
        }
      })
      .catch((error) => {
        if (active) setBackupError(t(authErrorKey(error)));
      });
    return () => {
      active = false;
    };
  }, [canBackup, t]);

  useEffect(() => {
    if (!isOwner || !hasPermission("settings.read")) return;
    let active = true;
    loadAdminSettings()
      .then((result) => {
        if (!active) return;
        setAllowlist(result.security.ipAllowlist);
        setAllowlistLoaded(true);
      })
      .catch((error) => {
        if (active) setAllowlistError(t(authErrorKey(error)));
      });
    return () => {
      active = false;
    };
  }, [isOwner, hasPermission]);

  async function startSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFactorError(null);
    if (!setupPassword) {
      setFactorError(t("auth.errorInput"));
      return;
    }
    setSetupBusy(true);
    try {
      const result = await startTwoFactorSetup(setupPassword);
      setSetup(result);
      setSetupPassword("");
    } catch (error) {
      setFactorError(t(authErrorKey(error)));
    } finally {
      setSetupBusy(false);
    }
  }

  async function confirmSetup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFactorError(null);
    if (!isCode(setupCode)) {
      setFactorError(t("admin.security.invalidCode"));
      return;
    }
    setSetupBusy(true);
    try {
      const result = await enableTwoFactor(setupCode);
      setRecoveryCodes(result.recoveryCodes);
      setSetup(null);
      setSetupCode("");
      toast.success(t("admin.security.enabledToast"));
      await loadFactor();
      await refresh();
    } catch (error) {
      setFactorError(t(authErrorKey(error)));
    } finally {
      setSetupBusy(false);
    }
  }

  async function submitRegen(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!regen) return;
    if (!regen.password || !isCode(regen.code)) {
      setFactorError(t("admin.security.invalidCode"));
      return;
    }
    setFactorBusy(true);
    try {
      const result = await regenerateRecoveryCodes(regen.password, regen.code);
      setRecoveryCodes(result.recoveryCodes);
      setRegen(null);
      toast.success(t("admin.security.regeneratedToast"));
      await loadFactor();
    } catch (error) {
      setFactorError(t(authErrorKey(error)));
    } finally {
      setFactorBusy(false);
    }
  }

  async function submitDisable(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!disable) return;
    if (!disable.password || !isCode(disable.code)) {
      setFactorError(t("admin.security.invalidCode"));
      return;
    }
    setFactorBusy(true);
    try {
      await disableTwoFactor(disable.password, disable.code);
      setDisable(null);
      setRecoveryCodes(null);
      toast.success(t("admin.security.disabledToast"));
      await loadFactor();
      await refresh();
    } catch (error) {
      setFactorError(t(authErrorKey(error)));
    } finally {
      setFactorBusy(false);
    }
  }

  async function submitPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPasswordError(null);
    if (!password.current || password.next.length < 12) {
      setPasswordError(t("auth.errorInput"));
      return;
    }
    if (password.next !== password.confirm) {
      setPasswordError(t("admin.security.passwordMismatch"));
      return;
    }
    setPasswordBusy(true);
    try {
      await changePassword(password.current, password.next);
      toast.success(t("admin.security.changedToast"));
      setPassword({ current: "", next: "", confirm: "" });
    } catch (error) {
      setPasswordError(t(authErrorKey(error)));
    } finally {
      setPasswordBusy(false);
    }
  }

  async function runBackup() {
    setBackupBusy(true);
    try {
      const result = await createBackup();
      setBackups((current) => [result.backup, ...(current ?? [])]);
      toast.success(t("admin.security.backupCreated"));
      setBackupError(null);
    } catch (error) {
      toast.error(t(authErrorKey(error)));
    } finally {
      setBackupBusy(false);
    }
  }

  async function saveNetwork(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAllowlistBusy(true);
    setAllowlistError(null);
    try {
      const result = await saveAdminSettings({ security: { ipAllowlist: allowlist } });
      setAllowlist(result.security.ipAllowlist);
      toast.success(t("admin.security.networkSaved"));
    } catch (error) {
      setAllowlistError(t(authErrorKey(error)));
    } finally {
      setAllowlistBusy(false);
    }
  }

  async function downloadOne(backup: BackupSummary) {
    setDownloading(backup.id);
    try {
      await downloadBackup(backup);
    } catch (error) {
      toast.error(t(authErrorKey(error)));
    } finally {
      setDownloading(null);
    }
  }

  async function exportAudit() {
    try {
      await downloadAuditExport();
      toast.success(t("admin.audit.exported"));
    } catch (error) {
      toast.error(t(authErrorKey(error)));
    }
  }

  const factorEnabled = Boolean(factor?.enabled);
  const factorRequired = Boolean(factor?.required);

  return (
    <AdminShell
      eyebrow={t("admin.security.eyebrow")}
      title={t("admin.security.title")}
      body={t("admin.security.body")}
    >
      {factor?.setupRequired ? (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-[color-mix(in_srgb,var(--brand-gold)_45%,transparent)] bg-[color-mix(in_srgb,var(--brand-gold)_10%,transparent)] px-4 py-3 text-sm text-foreground">
          <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--brand-gold)]" />
          <p className="leading-relaxed">{t("admin.security.setupBanner")}</p>
        </div>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Panel>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <Smartphone aria-hidden="true" className="size-4 text-[var(--accent-ink)]" />
              {t("admin.security.factorTitle")}
            </h2>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[0.65rem] font-semibold",
                factorEnabled
                  ? "border-[color-mix(in_srgb,var(--site-accent)_45%,transparent)] text-[var(--accent-ink)]"
                  : "border-[var(--site-border)] text-muted-foreground",
              )}
            >
              {factorEnabled ? (
                <CheckCircle2 aria-hidden="true" className="size-3" />
              ) : (
                <ShieldOff aria-hidden="true" className="size-3" />
              )}
              {t(factorEnabled ? "admin.security.factorEnabled" : "admin.security.factorDisabled")}
            </span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {t("admin.security.factorBody")}
          </p>
          <p className="mt-2 text-xs font-semibold text-[var(--accent-ink)]">
            {t(factorRequired ? "admin.security.factorRequired" : "admin.security.factorOptional")}
          </p>

          {factorError ? (
            <div className="mt-4">
              <FormAlert message={factorError} />
            </div>
          ) : null}

          {factor === null && !factorError ? (
            <p className="mt-4 text-sm text-muted-foreground">{t("auth.loading")}</p>
          ) : null}

          {factorEnabled ? (
            <div className="mt-4 space-y-3">
              <p className="text-xs text-muted-foreground">
                {t("admin.security.recoveryRemaining", {
                  count: formatNumber(factor?.recoveryCodesRemaining ?? 0, lang),
                })}
              </p>

              {recoveryCodes ? (
                <div>
                  <p className="text-xs font-semibold text-foreground">
                    {t("admin.security.recoveryCodes")}
                  </p>
                  <CodeList codes={recoveryCodes} />
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t("admin.security.recoveryNote")}
                  </p>
                </div>
              ) : null}

              {regen ? (
                <form onSubmit={submitRegen} className="space-y-3 border-t border-[var(--site-border)] pt-3">
                  <PasswordField
                    id="regen-password"
                    label={t("auth.password")}
                    value={regen.password}
                    onChange={(value) => setRegen({ ...regen, password: value })}
                    autoComplete="current-password"
                    disabled={factorBusy}
                  />
                  <Field id="regen-code" label={t("admin.security.codeLabel")}>
                    <input
                      id="regen-code"
                      value={regen.code}
                      onChange={(event) =>
                        setRegen({ ...regen, code: event.target.value.replace(/\D/g, "") })
                      }
                      inputMode="numeric"
                      maxLength={6}
                      disabled={factorBusy}
                      className={cn(fieldClass, "text-center font-mono tracking-[0.3em]")}
                    />
                  </Field>
                  <div className="flex flex-wrap gap-2">
                    <button type="submit" disabled={factorBusy} className={cn(primaryButtonClass, "h-10 w-auto px-4")}>
                      {factorBusy ? (
                        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                      ) : (
                        <RefreshCw aria-hidden="true" className="size-4" />
                      )}
                      {factorBusy ? t("admin.security.regenerating") : t("admin.security.regenerateCta")}
                    </button>
                    <button
                      type="button"
                      onClick={() => setRegen(null)}
                      disabled={factorBusy}
                      className={secondaryButtonClass}
                    >
                      {t("auth.cancel")}
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setRegen(emptyFactor);
                    setDisable(null);
                    setFactorError(null);
                  }}
                  className={secondaryButtonClass}
                >
                  <RefreshCw aria-hidden="true" className="size-4" />
                  {t("admin.security.regenerateCta")}
                </button>
              )}

              {!factorRequired ? (
                disable ? (
                  <form onSubmit={submitDisable} className="space-y-3 border-t border-[var(--site-border)] pt-3">
                    <PasswordField
                      id="disable-password"
                      label={t("auth.password")}
                      value={disable.password}
                      onChange={(value) => setDisable({ ...disable, password: value })}
                      autoComplete="current-password"
                      disabled={factorBusy}
                    />
                    <Field id="disable-code" label={t("admin.security.codeLabel")}>
                      <input
                        id="disable-code"
                        value={disable.code}
                        onChange={(event) =>
                          setDisable({ ...disable, code: event.target.value.replace(/\D/g, "") })
                        }
                        inputMode="numeric"
                        maxLength={6}
                        disabled={factorBusy}
                        className={cn(fieldClass, "text-center font-mono tracking-[0.3em]")}
                      />
                    </Field>
                    <div className="flex flex-wrap gap-2">
                      <button type="submit" disabled={factorBusy} className={cn(secondaryButtonClass, "text-[var(--danger-ink)]")}>
                        {t("admin.security.disableCta")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setDisable(null)}
                        disabled={factorBusy}
                        className={secondaryButtonClass}
                      >
                        {t("auth.cancel")}
                      </button>
                    </div>
                  </form>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setDisable(emptyFactor);
                      setRegen(null);
                      setFactorError(null);
                    }}
                    className={cn(secondaryButtonClass, "text-[var(--danger-ink)]")}
                  >
                    {t("admin.security.disableCta")}
                  </button>
                )
              ) : (
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {t("admin.security.disableBlocked")}
                </p>
              )}
            </div>
          ) : null}

          {!factorEnabled && factor !== null ? (
            setup ? (
              <form onSubmit={confirmSetup} className="mt-4 space-y-4">
                <div className="rounded-xl border border-[var(--site-border)] bg-[var(--surface-sunken)] p-3.5">
                  <p className="text-xs font-semibold text-foreground">
                    {t("admin.security.secretLabel")}
                  </p>
                  <p className="mt-1 break-all font-mono text-sm text-[var(--accent-ink)]" dir="ltr">
                    {setup.secret}
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
                    {t("admin.security.secretHint")}
                  </p>
                  <p className="mt-2 break-all font-mono text-[0.65rem] text-muted-foreground" dir="ltr">
                    {setup.otpauthUri}
                  </p>
                </div>
                <Field id="setup-code" label={t("admin.security.codeLabel")} hint={t("admin.security.otpauthHint")}>
                  <input
                    id="setup-code"
                    value={setupCode}
                    onChange={(event) => setSetupCode(event.target.value.replace(/\D/g, ""))}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    disabled={setupBusy}
                    aria-describedby="setup-code-hint"
                    className={cn(fieldClass, "text-center text-lg font-bold tracking-[0.35em]")}
                  />
                </Field>
                <button type="submit" disabled={setupBusy} className={primaryButtonClass}>
                  <ShieldCheck aria-hidden="true" className="size-4" />
                  {setupBusy ? t("admin.security.enabling") : t("admin.security.enableCta")}
                </button>
              </form>
            ) : (
              <form onSubmit={startSetup} className="mt-4 space-y-3">
                <PasswordField
                  id="setup-password"
                  label={t("auth.password")}
                  value={setupPassword}
                  onChange={setSetupPassword}
                  autoComplete="current-password"
                  disabled={setupBusy}
                />
                <button type="submit" disabled={setupBusy} className={primaryButtonClass}>
                  <KeyRound aria-hidden="true" className="size-4" />
                  {setupBusy ? t("admin.security.settingUp") : t("admin.security.setupCta")}
                </button>
              </form>
            )
          ) : null}
        </Panel>

        <Panel>
          <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <KeyRound aria-hidden="true" className="size-4 text-[var(--accent-ink)]" />
            {t("admin.security.passwordTitle")}
          </h2>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {t("admin.security.passwordBody")}
          </p>
          <form onSubmit={submitPassword} className="mt-4 space-y-4" noValidate>
            <PasswordField
              id="account-current-password"
              label={t("admin.security.currentPassword")}
              value={password.current}
              onChange={(value) => setPassword({ ...password, current: value })}
              autoComplete="current-password"
              disabled={passwordBusy}
            />
            <PasswordField
              id="account-new-password"
              label={t("admin.security.newPassword")}
              value={password.next}
              onChange={(value) => setPassword({ ...password, next: value })}
              autoComplete="new-password"
              hint={t("auth.passwordHint")}
              disabled={passwordBusy}
            />
            <PasswordField
              id="account-confirm-password"
              label={t("admin.security.confirmPassword")}
              value={password.confirm}
              onChange={(value) => setPassword({ ...password, confirm: value })}
              autoComplete="new-password"
              disabled={passwordBusy}
            />
            {passwordError ? <FormAlert message={passwordError} /> : null}
            <button type="submit" disabled={passwordBusy} className={primaryButtonClass}>
              {passwordBusy ? (
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <KeyRound aria-hidden="true" className="size-4" />
              )}
              {passwordBusy ? t("admin.security.changing") : t("admin.security.changeCta")}
            </button>
          </form>
        </Panel>

        {canBackup ? (
          <Panel>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
                <Database aria-hidden="true" className="size-4 text-[var(--accent-ink)]" />
                {t("admin.security.backupsTitle")}
              </h2>
              <button
                type="button"
                onClick={() => void runBackup()}
                disabled={backupBusy}
                className={cn(secondaryButtonClass, "h-9 px-3 text-xs")}
              >
                {backupBusy ? (
                  <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                ) : (
                  <Database aria-hidden="true" className="size-3.5" />
                )}
                {backupBusy ? t("admin.security.creatingBackup") : t("admin.security.createBackup")}
              </button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {t("admin.security.backupsBody")}
            </p>
            {backupError ? (
              <div className="mt-3">
                <FormAlert message={backupError} />
              </div>
            ) : null}
            {backups === null && !backupError ? (
              <p className="mt-4 text-sm text-muted-foreground">{t("auth.loading")}</p>
            ) : null}
            {backups && backups.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">{t("admin.security.backupEmpty")}</p>
            ) : null}
            {backups && backups.length > 0 ? (
              <ul className="mt-3 space-y-2">
                {backups.map((backup) => (
                  <li
                    key={backup.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--site-border)] bg-[var(--surface-sunken)] px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-foreground">
                        {formatDateTime(backup.createdAt, lang)}
                      </p>
                      <p className="text-[0.68rem] text-muted-foreground">
                        {t("admin.security.backupTables", {
                          count: formatNumber(backup.tableCount, lang),
                        })}{" "}
                        ·{" "}
                        {t("admin.security.backupRows", {
                          count: formatNumber(backup.rowCount, lang),
                        })}{" "}
                        · {Math.max(1, Math.round(backup.sizeBytes / 1024))} KB
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void downloadOne(backup)}
                      disabled={downloading === backup.id}
                      className={cn(secondaryButtonClass, "h-8 px-2.5 text-[0.7rem]")}
                    >
                      {downloading === backup.id ? (
                        <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                      ) : (
                        <Download aria-hidden="true" className="size-3.5" />
                      )}
                      {t("admin.security.download")}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              {t("admin.security.backupDanger")}
            </p>
          </Panel>
        ) : null}

        {isOwner ? (
          <Panel>
            <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <Network aria-hidden="true" className="size-4 text-[var(--accent-ink)]" />
              {t("admin.security.networkTitle")}
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {t("admin.security.networkBody")}
            </p>
            <form onSubmit={saveNetwork} className="mt-4 space-y-3">
              <Field
                id="security-allowlist"
                label={t("admin.security.allowlistLabel")}
                hint={t("admin.security.allowlistHint")}
              >
                <textarea
                  id="security-allowlist"
                  value={allowlist}
                  onChange={(event) => setAllowlist(event.target.value)}
                  disabled={!allowlistLoaded || allowlistBusy}
                  rows={3}
                  dir="ltr"
                  aria-describedby="security-allowlist-hint"
                  className="w-full rounded-xl border border-[var(--site-border)] bg-[var(--surface-sunken)] px-3.5 py-2.5 font-mono text-xs text-foreground outline-none transition focus:border-[var(--site-accent)] focus:ring-2 focus:ring-[color-mix(in_srgb,var(--site-accent)_32%,transparent)] disabled:opacity-60"
                />
              </Field>
              {allowlistError ? <FormAlert message={allowlistError} /> : null}
              <button
                type="submit"
                disabled={!allowlistLoaded || allowlistBusy}
                className={cn(secondaryButtonClass, "h-9 px-3 text-xs")}
              >
                {allowlistBusy ? (
                  <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                ) : (
                  <Network aria-hidden="true" className="size-3.5" />
                )}
                {t("admin.security.saveNetwork")}
              </button>
            </form>
          </Panel>
        ) : null}

        {canAudit ? (
          <Panel>
            <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
              <FileJson aria-hidden="true" className="size-4 text-[var(--accent-ink)]" />
              {t("admin.security.auditTitle")}
            </h2>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {t("admin.security.auditBody")}
            </p>
            <button
              type="button"
              onClick={() => void exportAudit()}
              className={cn(secondaryButtonClass, "mt-4 h-9 px-3 text-xs")}
            >
              <Download aria-hidden="true" className="size-3.5" />
              {t("admin.security.auditCta")}
            </button>
          </Panel>
        ) : null}
      </div>
    </AdminShell>
  );
}

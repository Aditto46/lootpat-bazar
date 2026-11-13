import { ArrowLeft, KeyRound, LogIn, ShieldCheck } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import {
  AuthShell,
  Field,
  FormAlert,
  PasswordField,
  fieldClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../components/auth/AuthShell";
import { useAuth, type PendingChallenge } from "../lib/auth";
import { authErrorKey } from "../lib/authError";
import { useI18n } from "../lib/i18n";
import { Link, safeNextPath, useRouter } from "../lib/router";
import { cn } from "@/lib/utils";

type FactorMode = "app" | "recovery";

export function LoginPage() {
  const { t } = useI18n();
  const { status, user, login, completeTwoFactor } = useAuth();
  const { navigate } = useRouter();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [challenge, setChallenge] = useState<PendingChallenge | null>(null);
  const [mode, setMode] = useState<FactorMode>("app");
  const [code, setCode] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const next = safeNextPath();

  useEffect(() => {
    if (status === "authenticated") {
      const target = user?.twoFactor.setupRequired ? "/admin/security" : next ?? "/account";
      navigate(target, { replace: true });
    }
  }, [status, user, navigate, next]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!identifier.trim() || !password) {
      setError(t("auth.errorInput"));
      return;
    }
    setBusy(true);
    try {
      const outcome = await login(identifier.trim(), password);
      if (outcome.kind === "challenge") {
        setChallenge(outcome.challenge);
        setBusy(false);
        return;
      }
      if (outcome.user.twoFactor.setupRequired) {
        navigate("/admin/security", { replace: true });
      }
    } catch (caught) {
      setError(t(authErrorKey(caught)));
      setBusy(false);
    }
  }

  async function onVerify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challenge) return;
    setError(null);
    const value = mode === "app" ? code.trim() : recoveryCode.trim();
    if (!value) {
      setError(t("auth.errorInput"));
      return;
    }
    setBusy(true);
    try {
      const signedIn = await completeTwoFactor(
        challenge.token,
        mode === "app" ? { code: value } : { recoveryCode: value },
      );
      if (signedIn.twoFactor.setupRequired) {
        navigate("/admin/security", { replace: true });
      } else {
        navigate(next ?? "/account", { replace: true });
      }
    } catch (caught) {
      setError(t(authErrorKey(caught)));
      setBusy(false);
    }
  }

  if (challenge) {
    return (
      <AuthShell
        eyebrow={t("auth.twoFactorEyebrow")}
        title={t("auth.twoFactorTitle")}
        body={t("auth.twoFactorBody")}
      >
        <form onSubmit={onVerify} className="space-y-5" noValidate>
          <div className="flex items-center gap-3 rounded-xl border border-[var(--site-border)] bg-[var(--surface-sunken)] px-3.5 py-3 text-xs text-muted-foreground">
            <ShieldCheck aria-hidden="true" className="size-4 shrink-0 text-[var(--accent-ink)]" />
            <span>{identifier}</span>
          </div>

          {mode === "app" ? (
            <Field
              id="login-otp"
              label={t("auth.twoFactorCode")}
              hint={t("auth.twoFactorCodeHint")}
            >
              <input
                id="login-otp"
                name="otp"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))}
                disabled={busy}
                aria-describedby="login-otp-hint"
                className={cn(fieldClass, "text-center text-lg font-bold tracking-[0.35em]")}
              />
            </Field>
          ) : (
            <Field
              id="login-recovery"
              label={t("auth.twoFactorRecovery")}
              hint={t("auth.twoFactorRecoveryHint")}
            >
              <input
                id="login-recovery"
                name="recovery"
                type="text"
                autoComplete="off"
                value={recoveryCode}
                onChange={(event) => setRecoveryCode(event.target.value.toUpperCase())}
                disabled={busy}
                placeholder="XXXXX-XXXXX"
                dir="ltr"
                aria-describedby="login-recovery-hint"
                className={cn(fieldClass, "font-mono tracking-widest")}
              />
            </Field>
          )}

          {error ? <FormAlert message={error} /> : null}

          <button type="submit" disabled={busy} className={primaryButtonClass}>
            <KeyRound aria-hidden="true" className="size-4" />
            {busy ? t("auth.verifying") : t("auth.verifyCta")}
          </button>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--site-border)] pt-4 text-sm">
            <button
              type="button"
              onClick={() => {
                setMode(mode === "app" ? "recovery" : "app");
                setError(null);
              }}
              disabled={busy}
              className="font-semibold text-[var(--accent-ink)] underline-offset-4 hover:underline"
            >
              {mode === "app" ? t("auth.useRecoveryCode") : t("auth.useAuthenticator")}
            </button>
            <button
              type="button"
              onClick={() => {
                setChallenge(null);
                setMode("app");
                setCode("");
                setRecoveryCode("");
                setError(null);
              }}
              disabled={busy}
              className="inline-flex items-center gap-1.5 text-muted-foreground transition hover:text-foreground"
            >
              <ArrowLeft aria-hidden="true" className="size-3.5" />
              {t("auth.backToPassword")}
            </button>
          </div>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      eyebrow={t("auth.loginEyebrow")}
      title={t("auth.loginTitle")}
      body={t("auth.loginBody")}
    >
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <Field id="login-identifier" label={t("auth.identifier")} hint={t("auth.identifierHint")}>
          <input
            id="login-identifier"
            name="identifier"
            type="text"
            inputMode="text"
            autoComplete="username"
            value={identifier}
            onChange={(event) => setIdentifier(event.target.value)}
            disabled={busy}
            aria-describedby="login-identifier-hint"
            className={fieldClass}
          />
        </Field>

        <PasswordField
          id="login-password"
          label={t("auth.password")}
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          disabled={busy}
        />

        {error ? <FormAlert message={error} /> : null}

        <button type="submit" disabled={busy} className={primaryButtonClass}>
          <LogIn aria-hidden="true" className="size-4" />
          {busy ? t("auth.loggingIn") : t("auth.loginCta")}
        </button>

        <p className="text-xs leading-relaxed text-muted-foreground">{t("auth.loginHint")}</p>

        <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--site-border)] pt-5 text-sm">
          <span className="text-muted-foreground">{t("auth.noAccount")}</span>
          <Link
            to={next ? `/register?next=${encodeURIComponent(next)}` : "/register"}
            className="font-semibold text-[var(--accent-ink)] underline-offset-4 hover:underline"
          >
            {t("auth.createAccount")}
          </Link>
        </div>

        <Link
          to="/privacy"
          className={cn(secondaryButtonClass, "w-full justify-center text-xs")}
        >
          <ShieldCheck aria-hidden="true" className="size-3.5" />
          {t("account.privacyLink")}
        </Link>

        {import.meta.env.DEV ? (
          <p className="rounded-xl border border-dashed border-[var(--site-border)] px-3.5 py-2.5 text-xs text-muted-foreground">
            {t("auth.demoHint")}
          </p>
        ) : null}
      </form>
    </AuthShell>
  );
}

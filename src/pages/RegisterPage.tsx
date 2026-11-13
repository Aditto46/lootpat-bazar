import { UserRoundPlus } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import {
  AuthShell,
  Field,
  FormAlert,
  PasswordField,
  fieldClass,
  primaryButtonClass,
} from "../components/auth/AuthShell";
import { useAuth } from "../lib/auth";
import { authErrorKey } from "../lib/authError";
import { useI18n } from "../lib/i18n";
import { Link, safeNextPath, useRouter } from "../lib/router";

type FieldErrors = {
  name?: string;
  email?: string;
  phone?: string;
  password?: string;
  confirm?: string;
};

const passwordPattern = /^(?=.*\p{L})(?=.*\d).{12,}$/u;

export function RegisterPage() {
  const { t } = useI18n();
  const { status, register } = useAuth();
  const { navigate } = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const next = safeNextPath();

  useEffect(() => {
    if (status === "authenticated") {
      navigate(next ?? "/account", { replace: true });
    }
  }, [status, navigate, next]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const trimmedName = name.trim();
    const trimmedEmail = email.trim();
    const trimmedPhone = phone.trim();
    const found: FieldErrors = {};

    if (trimmedName.length < 2) found.name = t("auth.errorInput");
    if (!trimmedEmail && !trimmedPhone) found.phone = t("auth.contactHint");
    if (!passwordPattern.test(password)) found.password = t("auth.passwordHint");
    if (password !== confirm) found.confirm = t("auth.confirmMismatch");

    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setBusy(true);
    try {
      await register({
        name: trimmedName,
        password,
        ...(trimmedEmail ? { email: trimmedEmail } : {}),
        ...(trimmedPhone ? { phone: trimmedPhone } : {}),
      });
    } catch (caught) {
      setFormError(t(authErrorKey(caught)));
      setBusy(false);
    }
  }

  return (
    <AuthShell
      eyebrow={t("auth.registerEyebrow")}
      title={t("auth.registerTitle")}
      body={t("auth.registerBody")}
    >
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        <Field id="register-name" label={t("auth.name")} error={errors.name}>
          <input
            id="register-name"
            name="name"
            type="text"
            autoComplete="name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={busy}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={errors.name ? "register-name-error" : undefined}
            className={fieldClass}
          />
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field id="register-email" label={t("auth.email")} error={errors.email}>
            <input
              id="register-email"
              name="email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={busy}
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={errors.email ? "register-email-error" : undefined}
              className={fieldClass}
            />
          </Field>

          <Field
            id="register-phone"
            label={t("auth.phone")}
            hint={t("auth.contactHint")}
            error={errors.phone}
          >
            <input
              id="register-phone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              placeholder="01712345678"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              disabled={busy}
              aria-invalid={errors.phone ? true : undefined}
              aria-describedby={errors.phone ? "register-phone-error" : "register-phone-hint"}
              className={fieldClass}
            />
          </Field>
        </div>

        <PasswordField
          id="register-password"
          label={t("auth.password")}
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          hint={t("auth.passwordHint")}
          error={errors.password}
          disabled={busy}
        />

        <PasswordField
          id="register-confirm"
          label={t("auth.confirmPassword")}
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          error={errors.confirm}
          disabled={busy}
        />

        {formError ? <FormAlert message={formError} /> : null}

        <button type="submit" disabled={busy} className={primaryButtonClass}>
          <UserRoundPlus aria-hidden="true" className="size-4" />
          {busy ? t("auth.registering") : t("auth.registerCta")}
        </button>

        <p className="text-xs leading-relaxed text-muted-foreground">{t("auth.termsNote")}</p>

        <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--site-border)] pt-5 text-sm">
          <span className="text-muted-foreground">{t("auth.haveAccount")}</span>
          <Link
            to={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}
            className="font-semibold text-[var(--accent-ink)] underline-offset-4 hover:underline"
          >
            {t("auth.signIn")}
          </Link>
        </div>
      </form>
    </AuthShell>
  );
}

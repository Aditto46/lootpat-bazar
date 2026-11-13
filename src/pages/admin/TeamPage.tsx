import {
  Ban,
  CheckCircle2,
  KeyRound,
  Mail,
  Phone,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  Field,
  FormAlert,
  PasswordField,
  fieldClass,
  primaryButtonClass,
  secondaryButtonClass,
} from "../../components/auth/AuthShell";
import { apiRequest, type TeamMember } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { authErrorKey } from "../../lib/authError";
import { formatDateTime, formatNumber, roleName, useI18n } from "../../lib/i18n";
import { assignableRoles, type AssignableRoleId } from "../../lib/roles";
import { cn } from "@/lib/utils";
import { AdminShell, Panel } from "./AdminShell";

type InviteState = {
  name: string;
  email: string;
  phone: string;
  password: string;
  role: AssignableRoleId;
};

const emptyInvite: InviteState = { name: "", email: "", phone: "", password: "", role: "staff" };

export function TeamPage() {
  const { t, lang } = useI18n();
  const { user, hasPermission } = useAuth();
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [invite, setInvite] = useState<InviteState>(emptyInvite);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [inviting, setInviting] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [resetTarget, setResetTarget] = useState<TeamMember | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);

  const canView = Boolean(user?.role.is_staff && hasPermission("team.read"));
  const canWrite = Boolean(canView && user?.role.id === "owner" && hasPermission("team.write"));

  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      try {
        const result = await apiRequest<{ team: TeamMember[] }>("/api/admin/team", { signal });
        setTeam(result.team);
        setLoadError(null);
      } catch (error) {
        if (signal?.aborted) return;
        setLoadError(t(authErrorKey(error)));
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    if (!canView) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [canView, load]);

  async function patchMember(
    member: TeamMember,
    patch: { role?: string; status?: "active" | "suspended" },
  ) {
    setBusyId(member.id);
    try {
      await apiRequest(`/api/admin/team/${member.id}`, { method: "PATCH", body: patch });
      toast.success(t("auth.updated"));
      await load();
    } catch (error) {
      toast.error(t(authErrorKey(error)));
    } finally {
      setBusyId(null);
    }
  }

  async function revokeSessions(member: TeamMember) {
    if (!window.confirm(`${member.name} — ${t("auth.revokeSessions")}?`)) return;
    setBusyId(member.id);
    try {
      await apiRequest(`/api/admin/team/${member.id}/revoke-sessions`, { method: "POST" });
      toast.success(t("auth.revoked"));
    } catch (error) {
      toast.error(t(authErrorKey(error)));
    } finally {
      setBusyId(null);
    }
  }

  async function resetTwoFactor(member: TeamMember) {
    if (!window.confirm(t("auth.resetFactorConfirm", { name: member.name }))) return;
    setBusyId(member.id);
    try {
      await apiRequest(`/api/admin/team/${member.id}/2fa-reset`, { method: "POST" });
      toast.success(t("auth.resetFactorDone"));
      await load();
    } catch (error) {
      toast.error(t(authErrorKey(error)));
    } finally {
      setBusyId(null);
    }
  }

  function openPasswordReset(member: TeamMember) {
    setResetTarget(member);
    setResetPassword("");
    setResetError(null);
  }

  async function submitPasswordReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resetTarget) return;
    if (resetPassword.length < 12) {
      setResetError(t("auth.passwordHint"));
      return;
    }
    setResetBusy(true);
    try {
      await apiRequest(`/api/admin/team/${resetTarget.id}/password`, {
        method: "POST",
        body: { password: resetPassword },
      });
      toast.success(t("auth.resetPasswordDone"));
      setResetTarget(null);
      setResetPassword("");
    } catch (error) {
      setResetError(t(authErrorKey(error)));
    } finally {
      setResetBusy(false);
    }
  }

  async function onInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInviteError(null);

    const name = invite.name.trim();
    const email = invite.email.trim();
    const phone = invite.phone.trim();
    if (name.length < 2 || (!email && !phone) || invite.password.length < 12) {
      setInviteError(t("auth.errorInput"));
      return;
    }

    setInviting(true);
    try {
      await apiRequest("/api/admin/team", {
        method: "POST",
        body: {
          name,
          password: invite.password,
          role: invite.role,
          ...(email ? { email } : {}),
          ...(phone ? { phone } : {}),
        },
      });
      toast.success(t("auth.invited"));
      setInvite(emptyInvite);
      await load();
    } catch (error) {
      setInviteError(t(authErrorKey(error)));
    } finally {
      setInviting(false);
    }
  }

  return (
    <AdminShell
      eyebrow={t("auth.adminEyebrow")}
      title={t("auth.adminTitle")}
      body={t("auth.adminBody")}
      actions={
        canView ? (
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className={secondaryButtonClass}
          >
            <RefreshCw aria-hidden="true" className={loading ? "size-4 animate-spin" : "size-4"} />
            {t("admin.refresh")}
          </button>
        ) : undefined
      }
    >
      {!canView ? (
        <Panel className="text-sm text-muted-foreground">{t("admin.notAllowed")}</Panel>
      ) : (
        <>
          {!canWrite ? (
            <p className="mb-5 inline-flex items-start gap-2 rounded-xl border border-[var(--site-border)] bg-[var(--surface-sunken)] px-3.5 py-2.5 text-xs text-muted-foreground">
              <ShieldAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-[var(--accent-ink)]" />
              {user?.role.id === "viewer" ? t("auth.viewerNote") : t("auth.ownerOnlyNote")}
            </p>
          ) : null}

          <div className="grid items-start gap-6 lg:grid-cols-[1.25fr_0.75fr]">
            <section aria-labelledby="team-heading">
              <div>
                <h2 id="team-heading" className="text-lg font-semibold text-foreground">
                  {t("auth.teamTitle")}
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t("auth.teamBody", { count: formatNumber(team.length, lang) })}
                </p>
              </div>

              {loadError ? (
                <div className="mt-4 space-y-3">
                  <FormAlert message={loadError} />
                  <button type="button" onClick={() => void load()} className={secondaryButtonClass}>
                    <RefreshCw aria-hidden="true" className="size-4" />
                    {t("admin.tryAgain")}
                  </button>
                </div>
              ) : null}

              {loading && team.length === 0 ? (
                <div className="mt-4 space-y-3" aria-busy="true">
                  {[0, 1, 2].map((row) => (
                    <div key={row} className="glass h-24 animate-pulse rounded-2xl" />
                  ))}
                </div>
              ) : null}

              {!loading && team.length === 0 && !loadError ? (
                <p className="glass mt-4 flex items-center gap-3 rounded-2xl p-5 text-sm text-muted-foreground">
                  <Users aria-hidden="true" className="size-4" />
                  {t("auth.teamEmpty")}
                </p>
              ) : null}

              <ul className="mt-4 space-y-3">
                {team.map((member) => {
                  const isSelf = member.id === user?.id;
                  const isOwner = member.role.id === "owner";
                  const manageable = canWrite && !isSelf && !isOwner;
                  const busy = busyId === member.id;

                  return (
                    <li key={member.id} className="glass rounded-2xl p-4 sm:p-5">
                      <div className="flex flex-wrap items-start gap-3">
                        <span
                          aria-hidden="true"
                          className="grid size-11 shrink-0 place-items-center rounded-xl border border-[var(--site-border)] bg-[var(--surface-sunken)] text-sm font-bold text-[var(--accent-ink)]"
                        >
                          {member.name.trim().slice(0, 1)}
                        </span>

                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="truncate font-semibold text-foreground">{member.name}</p>
                            {isSelf ? (
                              <span className="rounded-full border border-[var(--site-border)] px-2 py-0.5 text-[0.62rem] font-semibold uppercase tracking-wide text-muted-foreground">
                                {t("auth.you")}
                              </span>
                            ) : null}
                            <span
                              className={cn(
                                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.62rem] font-semibold",
                                member.status === "active"
                                  ? "border-[color-mix(in_srgb,var(--site-accent)_40%,transparent)] text-[var(--accent-ink)]"
                                  : "border-[color-mix(in_srgb,var(--danger-ink)_40%,transparent)] text-[var(--danger-ink)]",
                              )}
                            >
                              {member.status === "active" ? (
                                <CheckCircle2 aria-hidden="true" className="size-3" />
                              ) : (
                                <Ban aria-hidden="true" className="size-3" />
                              )}
                              {t(member.status === "active" ? "auth.active" : "auth.suspended")}
                            </span>
                            <span
                              title={t("auth.twoFactorBadge")}
                              className={cn(
                                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[0.62rem] font-semibold",
                                member.twoFactorEnabled
                                  ? "border-[color-mix(in_srgb,var(--site-accent)_40%,transparent)] text-[var(--accent-ink)]"
                                  : "border-[var(--site-border)] text-muted-foreground",
                              )}
                            >
                              <ShieldCheck aria-hidden="true" className="size-3" />
                              {t(member.twoFactorEnabled ? "auth.twoFactorOn" : "auth.twoFactorOff")}
                            </span>
                          </div>

                          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            {member.email ? (
                              <span className="inline-flex items-center gap-1.5">
                                <Mail aria-hidden="true" className="size-3.5" />
                                {member.email}
                              </span>
                            ) : null}
                            {member.phone ? (
                              <span className="inline-flex items-center gap-1.5" dir="ltr">
                                <Phone aria-hidden="true" className="size-3.5" />
                                {member.phone}
                              </span>
                            ) : null}
                          </div>

                          <p className="mt-1.5 text-xs text-muted-foreground">
                            {t("auth.lastLogin")}:{" "}
                            {member.lastLoginAt
                              ? formatDateTime(member.lastLoginAt, lang)
                              : t("auth.never")}
                          </p>
                        </div>

                        <div className="w-full sm:w-40">
                          {manageable ? (
                            <label className="sr-only" htmlFor={`role-${member.id}`}>
                              {t("auth.roleLabel")}
                            </label>
                          ) : null}
                          {manageable ? (
                            <select
                              id={`role-${member.id}`}
                              value={member.role.id}
                              disabled={busy}
                              onChange={(event) =>
                                void patchMember(member, { role: event.target.value })
                              }
                              className={cn(fieldClass, "h-9 px-2.5 text-xs")}
                            >
                              {assignableRoles.map((role) => (
                                <option key={role.id} value={role.id}>
                                  {lang === "bn" ? role.name_bn : role.name_en}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="inline-flex h-9 w-full items-center justify-center rounded-xl border border-[var(--site-border)] px-2.5 text-xs font-semibold text-muted-foreground">
                              {roleName(member.role, lang)}
                            </span>
                          )}
                        </div>
                      </div>

                      {manageable ? (
                        <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--site-border)] pt-4">
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              const nextStatus = member.status === "active" ? "suspended" : "active";
                              if (
                                nextStatus === "suspended" &&
                                !window.confirm(`${member.name} — ${t("auth.suspend")}?`)
                              ) {
                                return;
                              }
                              void patchMember(member, { status: nextStatus });
                            }}
                            className={cn(secondaryButtonClass, "h-9 px-3 text-xs")}
                          >
                            {member.status === "active" ? (
                              <Ban aria-hidden="true" className="size-3.5" />
                            ) : (
                              <CheckCircle2 aria-hidden="true" className="size-3.5" />
                            )}
                            {t(member.status === "active" ? "auth.suspend" : "auth.activate")}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void revokeSessions(member)}
                            className={cn(secondaryButtonClass, "h-9 px-3 text-xs")}
                          >
                            <KeyRound aria-hidden="true" className="size-3.5" />
                            {t("auth.revokeSessions")}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => openPasswordReset(member)}
                            className={cn(secondaryButtonClass, "h-9 px-3 text-xs")}
                          >
                            <KeyRound aria-hidden="true" className="size-3.5" />
                            {t("auth.resetPassword")}
                          </button>
                          <button
                            type="button"
                            disabled={busy || !member.twoFactorEnabled}
                            onClick={() => void resetTwoFactor(member)}
                            className={cn(secondaryButtonClass, "h-9 px-3 text-xs")}
                          >
                            <ShieldCheck aria-hidden="true" className="size-3.5" />
                            {t("auth.resetFactor")}
                          </button>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>

            {canWrite ? (
              <Panel className="lg:sticky lg:top-28">
                <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
                  <UserPlus aria-hidden="true" className="size-4 text-[var(--accent-ink)]" />
                  {t("auth.inviteTitle")}
                </h2>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                  {t("auth.inviteBody")}
                </p>

                <form onSubmit={onInvite} className="mt-5 space-y-4" noValidate>
                  <Field id="invite-name" label={t("auth.name")}>
                    <input
                      id="invite-name"
                      type="text"
                      autoComplete="off"
                      value={invite.name}
                      onChange={(event) => setInvite({ ...invite, name: event.target.value })}
                      disabled={inviting}
                      className={fieldClass}
                    />
                  </Field>

                  <Field id="invite-email" label={t("auth.email")}>
                    <input
                      id="invite-email"
                      type="email"
                      autoComplete="off"
                      value={invite.email}
                      onChange={(event) => setInvite({ ...invite, email: event.target.value })}
                      disabled={inviting}
                      className={fieldClass}
                    />
                  </Field>

                  <Field id="invite-phone" label={t("auth.phone")} hint={t("auth.contactHint")}>
                    <input
                      id="invite-phone"
                      type="tel"
                      autoComplete="off"
                      placeholder="01712345678"
                      value={invite.phone}
                      onChange={(event) => setInvite({ ...invite, phone: event.target.value })}
                      disabled={inviting}
                      aria-describedby="invite-phone-hint"
                      className={fieldClass}
                    />
                  </Field>

                  <PasswordField
                    id="invite-password"
                    label={t("auth.password")}
                    value={invite.password}
                    onChange={(value) => setInvite({ ...invite, password: value })}
                    autoComplete="new-password"
                    hint={t("auth.passwordHint")}
                    disabled={inviting}
                  />

                  <Field id="invite-role" label={t("auth.roleLabel")}>
                    <select
                      id="invite-role"
                      value={invite.role}
                      onChange={(event) =>
                        setInvite({ ...invite, role: event.target.value as AssignableRoleId })
                      }
                      disabled={inviting}
                      className={fieldClass}
                    >
                      {assignableRoles.map((role) => (
                        <option key={role.id} value={role.id}>
                          {lang === "bn" ? role.name_bn : role.name_en}
                        </option>
                      ))}
                    </select>
                  </Field>

                  {inviteError ? <FormAlert message={inviteError} /> : null}

                  <button type="submit" disabled={inviting} className={primaryButtonClass}>
                    <UserPlus aria-hidden="true" className="size-4" />
                    {inviting ? t("auth.inviting") : t("auth.inviteCta")}
                  </button>
                </form>
              </Panel>
            ) : null}
          </div>

          <Dialog
            open={resetTarget !== null}
            onOpenChange={(open) => {
              if (!open) setResetTarget(null);
            }}
          >
            <DialogContent className="max-w-sm">
              <DialogTitle className="font-heading text-lg font-bold">
                {t("auth.resetPasswordTitle")}
              </DialogTitle>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t("auth.resetPasswordBody", { name: resetTarget?.name ?? "" })}
              </p>
              <form onSubmit={submitPasswordReset} className="mt-2 space-y-3" noValidate>
                <PasswordField
                  id="reset-password"
                  label={t("auth.newPassword")}
                  value={resetPassword}
                  onChange={setResetPassword}
                  autoComplete="new-password"
                  hint={t("auth.passwordHint")}
                  disabled={resetBusy}
                />
                {resetError ? <FormAlert message={resetError} /> : null}
                <button type="submit" disabled={resetBusy} className={primaryButtonClass}>
                  <KeyRound aria-hidden="true" className="size-4" />
                  {t("auth.resetPassword")}
                </button>
              </form>
            </DialogContent>
          </Dialog>
        </>
      )}
    </AdminShell>
  );
}

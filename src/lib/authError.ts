import { ApiError } from "./api";
import type { DictKey } from "./i18n";

const byCode: Record<string, DictKey> = {
  invalid_credentials: "auth.errorInvalid",
  rate_limited: "auth.errorRateLimited",
  limiter_busy: "auth.errorRateLimited",
  limiter_unavailable: "auth.errorRateLimited",
  account_suspended: "auth.errorSuspended",
  account_exists: "auth.errorExists",
  forbidden: "auth.errorForbidden",
  origin_forbidden: "auth.errorForbidden",
  invalid_input: "auth.errorInput",
  payload_too_large: "auth.errorInput",
  setup_required: "auth.errorSetup",
  setup_not_configured: "auth.errorSetup",
  login_required: "auth.sessionEnded",
  network: "auth.errorNetwork",
  invalid_code: "auth.errorInvalidCode",
  invalid_challenge: "auth.errorChallengeExpired",
  two_factor_setup_required: "auth.errorTwoFactorRequired",
  two_factor_required_for_role: "auth.errorTwoFactorRequired",
  admin_ip_forbidden: "auth.errorIpForbidden",
  password_unchanged: "auth.passwordUnchanged",
  cannot_modify_self: "auth.cannotModifySelf",
  staff_account_delete_blocked: "account.deleteBlocked",
};

export function authErrorKey(error: unknown): DictKey {
  if (error instanceof ApiError) return byCode[error.code] ?? "auth.errorGeneric";
  return "auth.errorGeneric";
}

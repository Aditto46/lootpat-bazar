// Server-side authorization. A principal is rebuilt from the database on every
// request; the client never supplies a role or permission list.
import { AppError, rows } from "./http.mjs";

export const OWNER_ROLE = "owner";
export const CUSTOMER_ROLE = "customer";

export async function loadPrincipal(db, userId) {
  const found = rows(
    await db
      .from("users")
      .select("id,name,email,phone,role_id,status,last_login_at,created_at,deleted_at,two_factor_enabled_at")
      .eq("id", userId)
      .limit(1),
  );
  if (found.length !== 1) throw new AppError("login_required", 401);
  const user = found[0];
  if (user.deleted_at != null) throw new AppError("login_required", 401);
  if (user.status !== "active") throw new AppError("account_suspended", 403);

  const roles = rows(
    await db
      .from("roles")
      .select("id,name_bn,name_en,level,is_staff")
      .eq("id", user.role_id)
      .limit(1),
  );
  if (roles.length !== 1) throw new AppError("role_unavailable", 503);

  const grants = rows(
    await db.from("role_permissions").select("permission_id").eq("role_id", user.role_id),
  );

  // Step 9: Owner and Admin must enrol a second factor before staff APIs open.
  const twoFactorRequired =
    Boolean(roles[0].is_staff) && (user.role_id === OWNER_ROLE || user.role_id === "admin");
  const twoFactorEnabled = user.two_factor_enabled_at != null;

  return {
    user,
    role: roles[0],
    permissions: grants.map((grant) => grant.permission_id),
    twoFactorRequired,
    twoFactorEnabled,
    twoFactorSetupRequired: twoFactorRequired && !twoFactorEnabled,
  };
}

export function hasPermission(principal, permission) {
  return principal.permissions.includes(permission);
}

export function requirePermission(principal, permission) {
  if (principal.twoFactorSetupRequired) {
    throw new AppError("two_factor_setup_required", 403);
  }
  if (!hasPermission(principal, permission)) throw new AppError("forbidden", 403);
}

export function requireOwner(principal) {
  if (principal.role.id !== OWNER_ROLE) throw new AppError("forbidden", 403);
}

export function publicPrincipal(principal) {
  return {
    id: principal.user.id,
    name: principal.user.name,
    email: principal.user.email ?? null,
    phone: principal.user.phone ?? null,
    role: {
      id: principal.role.id,
      name_bn: principal.role.name_bn,
      name_en: principal.role.name_en,
      is_staff: principal.role.is_staff,
    },
    permissions: principal.permissions,
    twoFactor: {
      required: Boolean(principal.twoFactorRequired),
      enabled: Boolean(principal.twoFactorEnabled),
      setupRequired: Boolean(principal.twoFactorSetupRequired),
    },
  };
}

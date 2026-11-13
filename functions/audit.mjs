// Append-only admin audit trail. Writing the audit row never fails the action
// it describes: a lost audit row is reported to the operator by its absence,
// while a rolled-back order status would lose real work.
import { clientIp, rows } from "./http.mjs";

const MAX_SUMMARY = 200;
const MAX_DETAILS = 4000;

function serializeDetails(details) {
  if (details === undefined || details === null) return "{}";
  try {
    const text = JSON.stringify(details);
    return text.length <= MAX_DETAILS ? text : JSON.stringify({ truncated: true });
  } catch {
    return "{}";
  }
}

export async function recordAudit(db, request, principal, entry) {
  if (!principal?.user?.id) return false;
  const row = {
    id: crypto.randomUUID(),
    actor_user_id: principal.user.id,
    actor_name: String(principal.user.name ?? "").slice(0, 80),
    actor_role: String(principal.role?.id ?? "").slice(0, 40),
    action: String(entry.action).slice(0, 60),
    entity_type: String(entry.entityType).slice(0, 40),
    entity_id: entry.entityId === undefined || entry.entityId === null
      ? null
      : String(entry.entityId).slice(0, 120),
    summary: String(entry.summary ?? "").slice(0, MAX_SUMMARY),
    details: serializeDetails(entry.details),
    ip: clientIp(request),
    created_at: new Date().toISOString(),
  };

  try {
    const saved = rows(
      await db.from("audit_logs").insertIfAbsent(row, { onConflict: "id" }).select("id"),
    );
    return saved.length === 1;
  } catch {
    return false;
  }
}

// Gateway webhooks have no staff session; they are still recorded as system
// actions so a paid order always has a traceable cause.
export async function recordSystemAudit(db, entry) {
  const row = {
    id: crypto.randomUUID(),
    actor_user_id: null,
    actor_name: "Payment gateway",
    actor_role: "system",
    action: String(entry.action).slice(0, 60),
    entity_type: String(entry.entityType).slice(0, 40),
    entity_id: entry.entityId === undefined || entry.entityId === null
      ? null
      : String(entry.entityId).slice(0, 120),
    summary: String(entry.summary ?? "").slice(0, MAX_SUMMARY),
    details: serializeDetails(entry.details),
    ip: entry.ip ?? null,
    created_at: new Date().toISOString(),
  };

  try {
    const saved = rows(
      await db.from("audit_logs").insertIfAbsent(row, { onConflict: "id" }).select("id"),
    );
    return saved.length === 1;
  } catch {
    return false;
  }
}

export function parseDetails(value) {
  if (typeof value !== "string") return {};
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

import { apiDownload, apiRequest, saveBlob } from "./api";

export type TwoFactorStatus = {
  enabled: boolean;
  pending: boolean;
  required: boolean;
  setupRequired: boolean;
  recoveryCodesRemaining: number;
};

export type TwoFactorSetup = {
  secret: string;
  otpauthUri: string;
  digits: number;
  period: number;
};

export type BackupSummary = {
  id: string;
  createdAt: string;
  createdBy: string | null;
  tableCount: number;
  rowCount: number;
  sizeBytes: number;
  downloadUrl: string;
};

export type SecurityAuditQuery = {
  action?: string;
  q?: string;
  from?: string;
  to?: string;
  limit?: number;
};

export function loadTwoFactorStatus(signal?: AbortSignal): Promise<TwoFactorStatus> {
  return apiRequest<TwoFactorStatus>("/api/auth/2fa/status", { signal });
}

export function startTwoFactorSetup(password: string): Promise<TwoFactorSetup> {
  return apiRequest<TwoFactorSetup>("/api/auth/2fa/setup", {
    method: "POST",
    body: { password },
  });
}

export function enableTwoFactor(code: string): Promise<{ ok: boolean; recoveryCodes: string[] }> {
  return apiRequest("/api/auth/2fa/enable", { method: "POST", body: { code } });
}

export function disableTwoFactor(
  password: string,
  code: string,
): Promise<{ ok: boolean; enabled: boolean }> {
  return apiRequest("/api/auth/2fa/disable", { method: "POST", body: { password, code } });
}

export function regenerateRecoveryCodes(
  password: string,
  code: string,
): Promise<{ ok: boolean; recoveryCodes: string[] }> {
  return apiRequest("/api/auth/2fa/recovery", { method: "POST", body: { password, code } });
}

export function changePassword(
  currentPassword: string,
  newPassword: string,
): Promise<{ ok: boolean; revokedSessions: number }> {
  return apiRequest("/api/auth/password", {
    method: "POST",
    body: { currentPassword, newPassword },
  });
}

export function loadBackups(): Promise<{ backups: BackupSummary[] }> {
  return apiRequest("/api/admin/backups");
}

export function createBackup(): Promise<{ backup: BackupSummary }> {
  return apiRequest("/api/admin/backups", { method: "POST", body: {} });
}

export async function downloadBackup(backup: BackupSummary): Promise<void> {
  const { blob, filename } = await apiDownload(backup.downloadUrl);
  saveBlob(blob, filename ?? `lootpat-backup-${backup.id}.json`);
}

export function auditExportPath(query: SecurityAuditQuery = {}): string {
  const params = new URLSearchParams();
  if (query.action) params.set("action", query.action);
  if (query.q) params.set("q", query.q);
  if (query.from) params.set("from", query.from);
  if (query.to) params.set("to", query.to);
  const suffix = params.toString();
  return `/api/admin/audit/export${suffix ? `?${suffix}` : ""}`;
}

export async function downloadAuditExport(query: SecurityAuditQuery = {}): Promise<void> {
  const { blob, filename } = await apiDownload(auditExportPath(query));
  saveBlob(blob, filename ?? "lootpat-audit.json");
}

export async function exportMyData(): Promise<void> {
  const { blob, filename } = await apiDownload("/api/account/data-export");
  saveBlob(blob, filename ?? "lootpat-my-data.json");
}

export function deleteMyAccount(
  password: string,
  confirm: "DELETE",
): Promise<{ ok: boolean; revokedSessions: number }> {
  return apiRequest("/api/account/delete", { method: "POST", body: { password, confirm } });
}

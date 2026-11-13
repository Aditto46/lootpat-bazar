export type AuthRole = {
  id: string;
  name_bn: string;
  name_en: string;
  is_staff: boolean;
};

export type AuthUser = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: AuthRole;
  permissions: string[];
  twoFactor: { required: boolean; enabled: boolean; setupRequired: boolean };
};

export type MeResponse = {
  user: AuthUser;
  session: { expiresAt: string };
};

export type TwoFactorChallenge = {
  twoFactorRequired: true;
  challengeToken: string;
  expiresAt: string;
};

export type LoginResponse = { user: AuthUser; twoFactorSetupRequired?: boolean } | TwoFactorChallenge;

export type TeamMember = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: "active" | "suspended";
  lastLoginAt: string | null;
  createdAt: string;
  twoFactorEnabled: boolean;
  role: { id: string; name_bn: string; name_en: string; level: number };
};

export const API_BASE = "/functions/v1/app";

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly retryAfterSeconds: number | null;
  readonly details: Record<string, unknown>;

  constructor(
    code: string,
    status: number,
    retryAfterSeconds: number | null = null,
    details: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
    this.details = details;
  }
}

type RequestOptions = {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  signal?: AbortSignal;
};

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  const init: RequestInit = {
    method: options.method ?? "GET",
    credentials: "same-origin",
    headers,
    signal: options.signal,
  };
  if (options.body !== undefined) {
    headers["content-type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw new ApiError("network", 0);
  }

  if (!response.ok) {
    let code = "service_unavailable";
    let details: Record<string, unknown> = {};
    try {
      const payload = (await response.json()) as unknown;
      if (typeof payload === "object" && payload !== null) {
        const record = payload as Record<string, unknown>;
        details = record;
        if (typeof record.error === "string") code = record.error;
      }
    } catch {
      /* keep the generic code */
    }
    const retry = Number(response.headers.get("retry-after") ?? "");
    throw new ApiError(
      code,
      response.status,
      Number.isFinite(retry) && retry > 0 ? retry : null,
      details,
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// Authenticated file downloads (backups, audit export, personal data export)
// share the same error contract as JSON requests.
export async function apiDownload(
  path: string,
): Promise<{ blob: Blob; filename: string | null }> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
  } catch {
    throw new ApiError("network", 0);
  }

  if (!response.ok) {
    let code = "service_unavailable";
    let details: Record<string, unknown> = {};
    try {
      const payload = (await response.json()) as unknown;
      if (typeof payload === "object" && payload !== null) {
        const record = payload as Record<string, unknown>;
        details = record;
        if (typeof record.error === "string") code = record.error;
      }
    } catch {
      /* keep the generic code */
    }
    const retry = Number(response.headers.get("retry-after") ?? "");
    throw new ApiError(
      code,
      response.status,
      Number.isFinite(retry) && retry > 0 ? retry : null,
      details,
    );
  }

  const disposition = response.headers.get("content-disposition") ?? "";
  const match = /filename="([^"]+)"/.exec(disposition);
  return { blob: await response.blob(), filename: match ? match[1] : null };
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ApiError, apiRequest, type AuthUser, type LoginResponse, type MeResponse } from "./api";

type AuthStatus = "loading" | "authenticated" | "anonymous";

type AuthState = {
  status: AuthStatus;
  user: AuthUser | null;
  sessionExpiresAt: string | null;
};

type RegisterInput = {
  name: string;
  email?: string;
  phone?: string;
  password: string;
};

export type PendingChallenge = { token: string; expiresAt: string };

export type LoginOutcome =
  | { kind: "authenticated"; user: AuthUser }
  | { kind: "challenge"; challenge: PendingChallenge };

type AuthContextValue = AuthState & {
  login: (identifier: string, password: string) => Promise<LoginOutcome>;
  completeTwoFactor: (
    challengeToken: string,
    factor: { code?: string; recoveryCode?: string },
  ) => Promise<AuthUser>;
  register: (input: RegisterInput) => Promise<AuthUser>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  refresh: () => Promise<void>;
  hasPermission: (permission: string) => boolean;
};

const ANONYMOUS: AuthState = { status: "anonymous", user: null, sessionExpiresAt: null };

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading", user: null, sessionExpiresAt: null });

  const refresh = useCallback(async () => {
    try {
      const me = await apiRequest<MeResponse>("/api/auth/me");
      setState({ status: "authenticated", user: me.user, sessionExpiresAt: me.session.expiresAt });
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        setState(ANONYMOUS);
        return;
      }
      setState(ANONYMOUS);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(
    async (identifier: string, password: string): Promise<LoginOutcome> => {
      const result = await apiRequest<LoginResponse>("/api/auth/login", {
        method: "POST",
        body: { identifier, password },
      });
      if ("twoFactorRequired" in result) {
        return {
          kind: "challenge",
          challenge: { token: result.challengeToken, expiresAt: result.expiresAt },
        };
      }
      setState({ status: "authenticated", user: result.user, sessionExpiresAt: null });
      void refresh();
      return { kind: "authenticated", user: result.user };
    },
    [refresh],
  );

  const completeTwoFactor = useCallback(
    async (
      challengeToken: string,
      factor: { code?: string; recoveryCode?: string },
    ): Promise<AuthUser> => {
      const result = await apiRequest<{ user: AuthUser }>("/api/auth/login/2fa", {
        method: "POST",
        body: { challengeToken, ...factor },
      });
      setState({ status: "authenticated", user: result.user, sessionExpiresAt: null });
      void refresh();
      return result.user;
    },
    [refresh],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      const result = await apiRequest<{ user: AuthUser }>("/api/auth/register", {
        method: "POST",
        body: input,
      });
      setState({ status: "authenticated", user: result.user, sessionExpiresAt: null });
      void refresh();
      return result.user;
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    await apiRequest<{ ok: boolean }>("/api/auth/logout", { method: "POST" });
    setState(ANONYMOUS);
  }, []);

  const logoutAll = useCallback(async () => {
    await apiRequest<{ ok: boolean }>("/api/auth/logout-all", { method: "POST" });
    setState(ANONYMOUS);
  }, []);

  const hasPermission = useCallback(
    (permission: string) => state.user?.permissions.includes(permission) ?? false,
    [state.user],
  );

  const value = useMemo(
    () => ({
      ...state,
      login,
      completeTwoFactor,
      register,
      logout,
      logoutAll,
      refresh,
      hasPermission,
    }),
    [state, login, completeTwoFactor, register, logout, logoutAll, refresh, hasPermission],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}

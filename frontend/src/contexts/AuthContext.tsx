import * as React from "react";
import { authApi, AuthUser } from "../api/client";

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = React.createContext<AuthContextValue | null>(null);

function isTokenExpired(token: string): boolean {
  try {
    const payload = JSON.parse(atob(token.split(".")[1]));
    return payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = React.useState<AuthUser | null>(null);
  const [token, setToken] = React.useState<string | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);

  React.useEffect(() => {
    const stored = localStorage.getItem("subtitle_app_token");
    if (stored && !isTokenExpired(stored)) {
      setToken(stored);
      authApi
        .me()
        .then(setUser)
        .catch(() => {
          localStorage.removeItem("subtitle_app_token");
        })
        .finally(() => setIsLoading(false));
    } else {
      localStorage.removeItem("subtitle_app_token");
      setIsLoading(false);
    }
  }, []);

  const login = React.useCallback(async (email: string, password: string) => {
    const res = await authApi.login(email, password);
    localStorage.setItem("subtitle_app_token", res.token);
    setToken(res.token);
    setUser(res.user);
  }, []);

  const register = React.useCallback(async (email: string, password: string) => {
    const res = await authApi.register(email, password);
    localStorage.setItem("subtitle_app_token", res.token);
    setToken(res.token);
    setUser(res.user);
  }, []);

  const logout = React.useCallback(() => {
    localStorage.removeItem("subtitle_app_token");
    setToken(null);
    setUser(null);
    window.location.href = "/login";
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = React.useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, getToken, setToken } from "./api";

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: "USER" | "ACCOUNTANT" | "ADMIN";
  isActive: boolean;
  createdAt: string;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, fullName: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .get<{ user: User }>("/auth/me")
      .then((r) => setUser(r.data.user))
      .catch(() => setToken(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(email: string, password: string) {
    const r = await api.post<{ user: User; token: string }>("/auth/login", { email, password });
    setToken(r.data.token);
    setUser(r.data.user);
  }

  async function register(email: string, password: string, fullName: string) {
    const r = await api.post<{ user: User; token: string }>("/auth/register", { email, password, fullName });
    setToken(r.data.token);
    setUser(r.data.user);
  }

  async function logout() {
    try {
      await api.post("/auth/logout");
    } catch {
      // ignore — токен в любом случае стираем
    }
    setToken(null);
    setUser(null);
  }

  return <AuthCtx.Provider value={{ user, loading, login, register, logout }}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth должен использоваться внутри <AuthProvider>");
  return ctx;
}

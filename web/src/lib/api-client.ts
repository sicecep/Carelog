// API client for talking to the Go backend.
// All paths are proxied through /api/* to the backend running on :8080.

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8080";

export interface Envelope<T> {
  data: T | null;
  error: { code: string; message: string; status: number } | null;
  meta: { page: number; page_size: number; total: number } | null;
}

async function request<T>(
  path: string,
  options: RequestInit = {}
): Promise<Envelope<T>> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    credentials: "include", // include cookies for auth
  });

  const data: Envelope<T> = await res.json();

  if (!res.ok && data.error) {
    throw new APIError(data.error);
  }

  return data;
}

export class APIError extends Error {
  code: string;
  status: number;

  constructor(err: { code: string; message: string; status: number }) {
    super(err.message);
    this.name = "APIError";
    this.code = err.code;
    this.status = err.status;
  }
}

export const api = {
  get: <T>(path: string, headers?: Record<string, string>) =>
    request<T>(path, { method: "GET", headers }),
  post: <T>(path: string, body: unknown, headers?: Record<string, string>) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body), headers }),
  patch: <T>(path: string, body: unknown, headers?: Record<string, string>) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body), headers }),
  delete: <T>(path: string, headers?: Record<string, string>) =>
    request<T>(path, { method: "DELETE", headers }),
};

// Auth endpoints.
// CareLog is passwordless (AUTH-001): auth is magic-link only, no passwords anywhere.
export const authApi = {
  // POST /api/v1/auth/magic-link - Request a magic link to be sent to the email.
  requestMagicLink: async (email: string): Promise<{ sent: boolean }> => {
    await api.post<{ message: string }>("/api/v1/auth/magic-link", { email });
    return { sent: true };
  },

  // GET /api/v1/auth/me - Get current user and workspace memberships.
  // Requires cl_access cookie. Optionally accepts X-Workspace-ID header.
  me: (workspaceId?: string) => {
    const headers: Record<string, string> = {};
    if (workspaceId) headers["X-Workspace-ID"] = workspaceId;
    return api.get<{
      user: {
        id: string;
        email: string;
        full_name?: string;
        avatar_url?: string;
        locale: string;
        email_verified: boolean;
        onboarding_completed: boolean;
      };
      workspaces: { id: string; name: string; role: string; active: boolean }[];
    }>("/api/v1/auth/me", headers);
  },

  // POST /api/v1/auth/refresh - Rotate refresh token (uses cl_refresh cookie).
  refresh: () => api.post<{ message: string }>("/api/v1/auth/refresh", {}),

  // POST /api/v1/auth/logout - Revoke refresh token family and clear cookies.
  logout: () => api.post<{ message: string }>("/api/v1/auth/logout", {}),
};

// Workspace endpoints
export const workspaceApi = {
  list: () => api.get<{ id: string; name: string; plan: string }[]>("/api/v1/workspaces"),
  get: (id: string) => api.get<{ id: string; name: string; plan: string }>(`/api/v1/workspaces/${id}`),
  create: (name: string) => api.post<{ id: string; name: string }>("/api/v1/workspaces", { name }),
  update: (id: string, name: string) => api.patch<{ id: string; name: string }>(`/api/v1/workspaces/${id}`, { name }),
  delete: (id: string) => api.delete<void>(`/api/v1/workspaces/${id}`),
};

// Health check
export const healthApi = {
  healthz: () => api.get<{ status: string }>("/healthz"),
  readyz: () => api.get<{ status: string }>("/readyz"),
  version: () => api.get<{ version: string; timestamp: string }>("/api/v1/version"),
};
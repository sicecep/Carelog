// API client for talking to the Go backend.
// All paths are proxied through /api/* to the backend running on :8080.

import type { CareType, Module } from "./constants.generated";

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

// Shapes returned by the Go API. Kept here so components import one canonical
// type instead of hand-rolling their own copy.
export interface AuthUser {
  id: string;
  email: string;
  full_name?: string;
  avatar_url?: string;
  locale: string;
  email_verified: boolean;
  onboarding_completed: boolean;
}

export interface AuthWorkspace {
  id: string;
  name: string;
  role: string;
  active: boolean;
}

export interface MeResponse {
  user: AuthUser;
  workspaces: AuthWorkspace[];
}

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
  //
  // `extraHeaders` exists for Server Components: in the browser the cl_access
  // cookie rides along via `credentials: "include"`, but a server-side fetch has
  // no cookie jar, so the caller forwards the incoming `Cookie` header itself.
  me: (workspaceId?: string, extraHeaders?: Record<string, string>) => {
    const headers: Record<string, string> = { ...extraHeaders };
    if (workspaceId) headers["X-Workspace-ID"] = workspaceId;
    return api.get<MeResponse>("/api/v1/auth/me", headers);
  },

  // POST /api/v1/auth/refresh - Rotate refresh token (uses cl_refresh cookie).
  refresh: () => api.post<{ message: string }>("/api/v1/auth/refresh", {}),

  // POST /api/v1/auth/logout - Revoke refresh token family and clear cookies.
  logout: () => api.post<{ message: string }>("/api/v1/auth/logout", {}),
};

// Care recipients.
export interface Recipient {
  id: string;
  workspace_id: string;
  full_name: string;
  display_name?: string;
  care_type: CareType;
  enabled_modules: Module[];
  is_active: boolean;
  created_at: string;
}

export const recipientApi = {
  // GET /api/v1/recipients - List recipients in a workspace.
  // X-Workspace-ID is mandatory: the API answers 400 without it and 403 if the
  // caller isn't a member of that workspace.
  // See authApi.me for why `extraHeaders` exists.
  list: (workspaceId: string, extraHeaders?: Record<string, string>) =>
    api.get<Recipient[]>("/api/v1/recipients", {
      ...extraHeaders,
      "X-Workspace-ID": workspaceId,
    }),

  // POST /api/v1/recipients - Create a recipient (used by the onboarding wizard).
  create: (
    workspaceId: string,
    body: { full_name: string; care_type: CareType; enabled_modules: Module[] }
  ) => api.post<Recipient>("/api/v1/recipients", body, { "X-Workspace-ID": workspaceId }),
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
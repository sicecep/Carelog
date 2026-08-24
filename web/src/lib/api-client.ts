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
  get: <T>(path: string) => request<T>(path, { method: "GET" }),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};

// Auth endpoints.
// CareLog is passwordless (AUTH-001): auth is magic-link only, no passwords anywhere.
export const authApi = {
  // STUB: magic-link delivery is not wired up to the backend yet.
  // Resolves successfully so the UI can render its confirmation state.
  requestMagicLink: async (email: string): Promise<{ sent: boolean }> => {
    void email;
    return { sent: true };
  },
  refresh: () => api.post<{ accessToken: string }>("/api/v1/auth/refresh", {}),
  logout: () => api.post<void>("/api/v1/auth/logout", {}),
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
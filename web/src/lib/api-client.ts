// API client for talking to the Go backend.
// All paths are proxied through /api/* to the backend running on :8080.

import type { CareType, Module, LogCategory } from "./constants.generated";
import type { LogSubcategory } from "./log-subcategories";

// Paths are proxied through /api/* to the Go backend by next.config.ts
// rewrites. In the browser a relative base is correct — the request resolves
// against whatever origin loaded the page (critical when accessed via
// Tailscale IP or from a phone, where "localhost" would resolve to the
// device itself). But this module also runs server-side (Server Components
// call it during SSR), and Node's fetch cannot resolve a relative URL — there
// is no window.location to anchor it to, so it throws
// "Failed to parse URL from /api/v1/...". Server-side calls need an absolute
// origin; API_INTERNAL_URL lets that differ from the public-facing API base
// (e.g. talking to the Go container directly instead of bouncing back out
// through Tailscale).
const API_BASE =
  typeof window === "undefined"
    ? process.env.API_INTERNAL_URL || process.env.API_PROXY_TARGET || "http://localhost:8080"
    : "";

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

export interface ReportEntry {
  id: string;
  report_id: string;
  category: LogCategory;
  subcategory?: LogSubcategory;
  value_text?: string;
  value_number?: number;
  occurred_at: string;
  contributor_id: string;
  contributor_name: string;
  contributor_role: string;
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

  // GET /api/v1/recipients/{id} - Fetch a single recipient (detail page).
  get: (workspaceId: string, recipientId: string, extraHeaders?: Record<string, string>) =>
    api.get<Recipient>(`/api/v1/recipients/${recipientId}`, {
      ...extraHeaders,
      "X-Workspace-ID": workspaceId,
    }),

  // POST /api/v1/recipients - Create a recipient (used by the onboarding wizard).
  create: (
    workspaceId: string,
    body: { full_name: string; care_type: CareType; enabled_modules: Module[] }
  ) => api.post<Recipient>("/api/v1/recipients", body, { "X-Workspace-ID": workspaceId }),

  // GET /api/v1/recipients/{recipientID}/timeline?date=YYYY-MM-DD - unified
  // day timeline merging all contributors' entries (RPT-001).
  getTimeline: (
    workspaceId: string,
    recipientId: string,
    date?: string,
    extraHeaders?: Record<string, string>
  ) =>
    api.get<ReportEntry[]>(
      `/api/v1/recipients/${recipientId}/timeline${date ? `?date=${date}` : ""}`,
      { ...extraHeaders, "X-Workspace-ID": workspaceId }
    ),

  // POST /api/v1/recipients/{recipientID}/entries - Add a log entry.
  createEntry: (
    workspaceId: string,
    recipientId: string,
    body: {
      category: LogCategory;
      subcategory?: LogSubcategory;
      value_text?: string;
      value_number?: number;
      occurred_at?: string;
    }
  ) =>
    api.post<ReportEntry>(`/api/v1/recipients/${recipientId}/entries`, body, {
      "X-Workspace-ID": workspaceId,
    }),
};

// Incidents (PRD §6.5). Severity ordering matters for INC-003 visual weighting.
export type IncidentSeverity = "low" | "medium" | "high" | "emergency";
export type IncidentType =
  | "fall"
  | "injury"
  | "medical"
  | "behavioral"
  | "environmental"
  | "other";

export interface Incident {
  id: string;
  workspace_id: string;
  recipient_id: string;
  reporter_id: string;
  reporter_name?: string;
  type: IncidentType;
  severity: IncidentSeverity;
  severity_rank: number;
  description: string;
  action_taken?: string;
  occurred_at: string;
  created_at: string;
  // INC-ACK: present once the owner has acknowledged this incident.
  acknowledged_by?: string;
  acknowledged_at?: string;
  ack_comment?: string;
}

export const incidentApi = {
  // GET /api/v1/incidents - INC-005 owner incident log.
  list: (
    workspaceId: string,
    params?: { from?: string; to?: string; severity?: IncidentSeverity },
    extraHeaders?: Record<string, string>
  ) => {
    const qs = new URLSearchParams();
    if (params?.from) qs.set("from", params.from);
    if (params?.to) qs.set("to", params.to);
    if (params?.severity) qs.set("severity", params.severity);
    const suffix = qs.toString() ? `?${qs}` : "";
    return api.get<Incident[]>(`/api/v1/incidents${suffix}`, {
      ...extraHeaders,
      "X-Workspace-ID": workspaceId,
    });
  },

  // GET /api/v1/recipients/{id}/incidents - RPT-001.6, pinned on the timeline.
  listForRecipient: (
    workspaceId: string,
    recipientId: string,
    date?: string,
    extraHeaders?: Record<string, string>
  ) =>
    api.get<Incident[]>(
      `/api/v1/recipients/${recipientId}/incidents${date ? `?date=${date}` : ""}`,
      { ...extraHeaders, "X-Workspace-ID": workspaceId }
    ),

  // POST /api/v1/recipients/{id}/incidents - INC-001/INC-002.
  // Reporter attribution is server-side from the session; never sent here.
  create: (
    workspaceId: string,
    recipientId: string,
    body: {
      type: IncidentType;
      severity: IncidentSeverity;
      description: string;
      action_taken?: string;
      occurred_at?: string;
    }
  ) =>
    api.post<Incident>(`/api/v1/recipients/${recipientId}/incidents`, body, {
      "X-Workspace-ID": workspaceId,
    }),

  // POST /api/v1/incidents/{id}/acknowledge - INC-ACK (PRD §6.5).
  acknowledge: (
    workspaceId: string,
    incidentId: string,
    body: { comment?: string }
  ) =>
    api.post<Incident>(`/api/v1/incidents/${incidentId}/acknowledge`, body, {
      "X-Workspace-ID": workspaceId,
    }),
};

// Invitations (PRD §6.1, WRK-004)
export interface Invitation {
  id: string;
  workspace_id: string;
  recipient_id?: string;
  invitee_name: string;
  role: "caregiver" | "viewer";
  expires_at: string;
  whatsapp_link?: string;
}

export const invitationApi = {
  // POST /api/v1/invitations - Owner creates an invite
  create: (
    workspaceId: string,
    body: { invitee_name: string; role: string; recipient_id?: string; whatsapp_phone?: string }
  ) =>
    api.post<Invitation>("/api/v1/invitations", body, {
      "X-Workspace-ID": workspaceId,
    }),

  // GET /api/v1/invites/{token} - Public preview
  get: (token: string) => api.get<Invitation>(`/api/v1/invites/${token}`),

  // POST /api/v1/invites/{token}/claim - Claim the invite
  claim: (token: string) => api.post<{ workspace_id: string }>(`/api/v1/invites/${token}/claim`, {}),
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

/**
 * Thin typed wrapper around the Express API for use inside e2e tests
 * (Node.js context — not a browser page).
 */

const API_BASE = process.env.E2E_API_URL ?? "http://localhost:3001";

async function req<T>(method: string, path: string, token?: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) throw new Error(`API ${method} ${path} → ${res.status}: ${await res.text()}`);
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const api = {
  auth: {
    register: (email: string, password: string) =>
      req<{ token: string; user: { id: string; email: string } }>(
        "POST", "/api/auth/register", undefined, { email, password }
      ),
    login: (email: string, password: string) =>
      req<{ token: string; user: { id: string; email: string } }>(
        "POST", "/api/auth/login", undefined, { email, password }
      ),
  },
  projects: {
    list: (token: string) =>
      req<{ items: any[]; total: number }>("GET", "/api/projects", token),
    get: (token: string, projectId: string) =>
      req<any>("GET", `/api/projects/${projectId}`, token),
    patch: (token: string, projectId: string, body: any) =>
      req<{ updatedAt: string }>("PATCH", `/api/projects/${projectId}`, token, body),
    delete: (token: string, projectId: string) =>
      req<void>("DELETE", `/api/projects/${projectId}`, token),
    status: (token: string, projectId: string) =>
      req<{ status: string; errorMessage?: string }>(
        "GET", `/api/projects/${projectId}/status`, token
      ),
  },
  upload: {
    presigned: (token: string, filename: string, contentType: string, size: number, language = "en") =>
      req<{ projectId: string; uploadUrl: string; s3Key: string }>(
        "POST", "/api/upload/presigned", token, { filename, contentType, fileSizeBytes: size, language }
      ),
    complete: (token: string, projectId: string, videoDuration: number, videoWidth: number, videoHeight: number) =>
      req<{ projectId: string; status: string }>(
        "POST", `/api/upload/${projectId}/complete`, token,
        { videoDuration, videoWidth, videoHeight }
      ),
  },
};

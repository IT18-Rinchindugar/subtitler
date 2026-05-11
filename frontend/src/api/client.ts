const BASE = "/api";

function getToken(): string | null {
  return localStorage.getItem("subtitle_app_token");
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown
): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 401) {
    localStorage.removeItem("subtitle_app_token");
    window.location.href = "/login";
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error ?? "Request failed");
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  email: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export const authApi = {
  register: (email: string, password: string) =>
    request<AuthResponse>("POST", "/auth/register", { email, password }),
  login: (email: string, password: string) =>
    request<AuthResponse>("POST", "/auth/login", { email, password }),
  me: () => request<AuthUser>("GET", "/auth/me"),
};

// ── Upload ────────────────────────────────────────────────────────────────────

export interface PresignedResponse {
  projectId: string;
  uploadUrl: string;
  s3Key: string;
}

export const uploadApi = {
  getPresignedUrl: (
    filename: string,
    contentType: string,
    fileSizeBytes: number,
    language: string
  ) =>
    request<PresignedResponse>("POST", "/upload/presigned", {
      filename,
      contentType,
      fileSizeBytes,
      language,
    }),

  complete: (
    projectId: string,
    videoDuration: number,
    videoWidth: number,
    videoHeight: number
  ) =>
    request<{ projectId: string; status: string }>(
      "POST",
      `/upload/${projectId}/complete`,
      { videoDuration, videoWidth, videoHeight }
    ),
};

// ── Projects ──────────────────────────────────────────────────────────────────

export interface ProjectSummary {
  id: string;
  title: string;
  status: "uploading" | "transcribing" | "ready" | "error";
  videoFilename: string;
  videoDuration: number | null;
  thumbnailUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SubtitleCue {
  id: number;
  text: string;
  timestamp: [number, number | null];
}

export interface WordChunk {
  text: string;
  timestamp: [number, number | null];
}

export interface ProjectDetail {
  id: string;
  title: string;
  status: "uploading" | "transcribing" | "ready" | "error";
  errorMessage: string | null;
  videoUrl: string | null;
  videoDuration: number | null;
  videoWidth: number | null;
  videoHeight: number | null;
  language: string;
  styleJson: Record<string, unknown> | null;
  cues: SubtitleCue[];
  wordChunks: WordChunk[];
  createdAt: string;
  updatedAt: string;
}

export interface ProjectsPage {
  items: ProjectSummary[];
  total: number;
  page: number;
  limit: number;
}

export interface ProjectStatus {
  status: ProjectDetail["status"];
  errorMessage?: string;
}

export const projectsApi = {
  list: (page = 1, limit = 20) =>
    request<ProjectsPage>("GET", `/projects?page=${page}&limit=${limit}`),

  get: (projectId: string) =>
    request<ProjectDetail>("GET", `/projects/${projectId}`),

  patch: (
    projectId: string,
    patch: {
      title?: string;
      styleJson?: Record<string, unknown>;
      cues?: Array<{ text: string; timestamp: [number, number | null]; wordChunks?: unknown[] }>;
      wordChunks?: WordChunk[];
    }
  ) => request<{ updatedAt: string }>("PATCH", `/projects/${projectId}`, patch),

  delete: (projectId: string) =>
    request<void>("DELETE", `/projects/${projectId}`),

  getStatus: (projectId: string) =>
    request<ProjectStatus>("GET", `/projects/${projectId}/status`),
};

// ── S3 direct upload ──────────────────────────────────────────────────────────

export async function uploadFileToS3(
  uploadUrl: string,
  file: File,
  onProgress?: (pct: number) => void
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", file.type);
    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
      };
    }
    xhr.onload = () => (xhr.status < 300 ? resolve() : reject(new Error(`S3 upload failed: ${xhr.status}`)));
    xhr.onerror = () => reject(new Error("S3 upload network error"));
    xhr.send(file);
  });
}

export async function getVideoMetadata(
  file: File
): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      resolve({
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
      });
      URL.revokeObjectURL(video.src);
    };
    video.onerror = () => reject(new Error("Failed to read video metadata"));
    video.src = URL.createObjectURL(file);
  });
}

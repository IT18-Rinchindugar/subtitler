import { test, expect } from "@playwright/test";
import { uniqueEmail, createUser } from "./helpers/auth";
import { api } from "./helpers/api";

const PASSWORD = "Test1234!";
const INTERNAL_SECRET = process.env.INTERNAL_SECRET ?? "internal_secret_change_me";
const API_BASE = process.env.E2E_API_URL ?? "http://localhost:3001";

async function markReady(projectId: string, cues = defaultCues()) {
  const res = await fetch(`${API_BASE}/api/internal/transcription-complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-secret": INTERNAL_SECRET },
    body: JSON.stringify({ projectId, status: "ready", cues, wordChunks: defaultWordChunks() }),
  });
  if (!res.ok) throw new Error(`markReady failed: ${res.status}`);
}

async function markError(projectId: string, errorMessage = "Test error") {
  const res = await fetch(`${API_BASE}/api/internal/transcription-complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-secret": INTERNAL_SECRET },
    body: JSON.stringify({ projectId, status: "error", errorMessage }),
  });
  if (!res.ok) throw new Error(`markError failed: ${res.status}`);
}

function defaultCues() {
  return [
    { text: "Hello world", timestamp: [0, 2.5] },
    { text: "This is a test.", timestamp: [3, 5] },
  ];
}

function defaultWordChunks() {
  return [
    { text: "Hello", timestamp: [0, 0.5] },
    { text: " world", timestamp: [0.5, 2.5] },
    { text: "This", timestamp: [3, 3.4] },
    { text: " is", timestamp: [3.4, 3.6] },
    { text: " a", timestamp: [3.6, 3.7] },
    { text: " test.", timestamp: [3.7, 5] },
  ];
}

test.describe("Projects API", () => {
  test("list projects returns empty array for new user", async () => {
    const { token } = await createUser(uniqueEmail(), PASSWORD);
    const result = await api.projects.list(token);
    expect(result.total).toBe(0);
    expect(result.items).toHaveLength(0);
  });

  test("get project returns 404 for unknown id", async () => {
    const { token } = await createUser(uniqueEmail(), PASSWORD);
    const res = await fetch(`${API_BASE}/api/projects/00000000-0000-0000-0000-000000000000`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });

  test("cannot access another user's project", async () => {
    const { token: t1 } = await createUser(uniqueEmail(), PASSWORD);
    const { token: t2 } = await createUser(uniqueEmail(), PASSWORD);

    const { projectId } = await api.upload.presigned(t1, "private.mp4", "video/mp4", 5000);

    // User 2 tries to fetch user 1's project
    const res = await fetch(`${API_BASE}/api/projects/${projectId}`, {
      headers: { Authorization: `Bearer ${t2}` },
    });
    expect(res.status).toBe(404);
  });

  test("status endpoint returns current project status", async () => {
    const { token } = await createUser(uniqueEmail(), PASSWORD);
    const { projectId } = await api.upload.presigned(token, "status.mp4", "video/mp4", 5000);
    await api.upload.complete(token, projectId, 3, 320, 240);

    const status = await api.projects.status(token, projectId);
    expect(status.status).toBe("transcribing");
  });

  test("internal callback sets status to ready and saves cues", async () => {
    const { token } = await createUser(uniqueEmail(), PASSWORD);
    const { projectId } = await api.upload.presigned(token, "ready.mp4", "video/mp4", 5000);
    await api.upload.complete(token, projectId, 5, 320, 240);

    await markReady(projectId);

    const project = await api.projects.get(token, projectId);
    expect(project.status).toBe("ready");
    expect(project.cues).toHaveLength(2);
    expect(project.cues[0].text).toBe("Hello world");
    expect(project.cues[0].timestamp[0]).toBe(0);
    expect(project.wordChunks.length).toBeGreaterThan(0);
  });

  test("internal callback sets status to error", async () => {
    const { token } = await createUser(uniqueEmail(), PASSWORD);
    const { projectId } = await api.upload.presigned(token, "error.mp4", "video/mp4", 5000);
    await api.upload.complete(token, projectId, 5, 320, 240);

    await markError(projectId, "faster-whisper OOM");

    const project = await api.projects.get(token, projectId);
    expect(project.status).toBe("error");
    expect(project.errorMessage).toBe("faster-whisper OOM");
  });

  test("internal callback rejects wrong secret", async () => {
    const { token } = await createUser(uniqueEmail(), PASSWORD);
    const { projectId } = await api.upload.presigned(token, "forbidden.mp4", "video/mp4", 5000);

    const res = await fetch(`${API_BASE}/api/internal/transcription-complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": "wrong_secret" },
      body: JSON.stringify({ projectId, status: "ready", cues: [] }),
    });
    expect(res.status).toBe(403);
  });

  test("patch updates project title", async () => {
    const { token } = await createUser(uniqueEmail(), PASSWORD);
    const { projectId } = await api.upload.presigned(token, "rename.mp4", "video/mp4", 5000);
    await api.upload.complete(token, projectId, 5, 320, 240);
    await markReady(projectId);

    await api.projects.patch(token, projectId, { title: "My renamed project" });

    const project = await api.projects.get(token, projectId);
    expect(project.title).toBe("My renamed project");
  });

  test("patch saves subtitle cues", async () => {
    const { token } = await createUser(uniqueEmail(), PASSWORD);
    const { projectId } = await api.upload.presigned(token, "save-cues.mp4", "video/mp4", 5000);
    await api.upload.complete(token, projectId, 5, 320, 240);
    await markReady(projectId);

    const newCues = [
      { text: "Edited subtitle one", timestamp: [0, 1.5] as [number, number] },
      { text: "Edited subtitle two", timestamp: [2, 4] as [number, number] },
      { text: "Edited subtitle three", timestamp: [4, null] as [number, null] },
    ];

    await api.projects.patch(token, projectId, { cues: newCues });

    const project = await api.projects.get(token, projectId);
    expect(project.cues).toHaveLength(3);
    expect(project.cues[0].text).toBe("Edited subtitle one");
    expect(project.cues[2].timestamp[1]).toBeNull();
  });

  test("patch saves style JSON", async () => {
    const { token } = await createUser(uniqueEmail(), PASSWORD);
    const { projectId } = await api.upload.presigned(token, "style.mp4", "video/mp4", 5000);
    await api.upload.complete(token, projectId, 5, 320, 240);
    await markReady(projectId);

    const styleJson = { fontSize: 24, fontFamily: "Bebas Neue", color: "#ffffff" };
    await api.projects.patch(token, projectId, { styleJson });

    const project = await api.projects.get(token, projectId);
    expect(project.styleJson).toMatchObject(styleJson);
  });

  test("delete project removes it from list", async () => {
    const { token } = await createUser(uniqueEmail(), PASSWORD);
    const { projectId } = await api.upload.presigned(token, "delete-me.mp4", "video/mp4", 5000);

    await api.projects.delete(token, projectId);

    const projects = await api.projects.list(token);
    const found = projects.items.find((p: any) => p.id === projectId);
    expect(found).toBeUndefined();
  });

  test("delete returns 404 when project already deleted", async () => {
    const { token } = await createUser(uniqueEmail(), PASSWORD);
    const { projectId } = await api.upload.presigned(token, "double-delete.mp4", "video/mp4", 5000);

    await api.projects.delete(token, projectId);

    const res = await fetch(`${API_BASE}/api/projects/${projectId}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(404);
  });

  test("list is paginated correctly", async () => {
    const { token } = await createUser(uniqueEmail(), PASSWORD);

    // Create 3 projects
    for (let i = 0; i < 3; i++) {
      await api.upload.presigned(token, `page${i}.mp4`, "video/mp4", 5000);
    }

    const page1 = await api.projects.list(token);
    expect(page1.total).toBe(3);
    expect(page1.items).toHaveLength(3);

    const res = await fetch(`${API_BASE}/api/projects?page=1&limit=2`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const paginated = await res.json();
    expect(paginated.items).toHaveLength(2);
    expect(paginated.total).toBe(3);
  });
});

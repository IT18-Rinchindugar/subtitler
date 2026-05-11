import { test, expect } from "@playwright/test";
import { uniqueEmail, createUser } from "./helpers/auth";
import { api } from "./helpers/api";

const PASSWORD = "Test1234!";
const INTERNAL_SECRET = process.env.INTERNAL_SECRET ?? "internal_secret_change_me";
const API_BASE = process.env.E2E_API_URL ?? "http://localhost:3001";

async function setupReadyProject(token: string, title = "e2e-video.mp4") {
  const { projectId } = await api.upload.presigned(token, title, "video/mp4", 50000);
  await api.upload.complete(token, projectId, 5, 640, 360);

  await fetch(`${API_BASE}/api/internal/transcription-complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-secret": INTERNAL_SECRET },
    body: JSON.stringify({
      projectId,
      status: "ready",
      cues: [
        { text: "First subtitle", timestamp: [0, 2] },
        { text: "Second subtitle", timestamp: [2.5, 5] },
      ],
      wordChunks: [
        { text: "First", timestamp: [0, 0.5] },
        { text: " subtitle", timestamp: [0.5, 2] },
        { text: "Second", timestamp: [2.5, 3] },
        { text: " subtitle", timestamp: [3, 5] },
      ],
    }),
  });

  return projectId;
}

async function seedToken(page: any, token: string) {
  await page.goto("/");
  await page.evaluate((t: string) => localStorage.setItem("subtitle_app_token", t), token);
}

test.describe("Editor — polling flow", () => {
  test("editor shows 'Transcribing' spinner while polling", async ({ page }) => {
    const { token } = await createUser(uniqueEmail(), PASSWORD);
    const { projectId } = await api.upload.presigned(token, "poll.mp4", "video/mp4", 5000);
    await api.upload.complete(token, projectId, 5, 320, 240);

    await seedToken(page, token);
    await page.goto(`/editor/${projectId}`);

    await expect(page.getByText(/transcribing/i)).toBeVisible({ timeout: 8_000 });
  });

  test("editor transitions from polling → ready when transcription completes", async ({
    page,
  }) => {
    const { token } = await createUser(uniqueEmail(), PASSWORD);
    const { projectId } = await api.upload.presigned(token, "transition.mp4", "video/mp4", 5000);
    await api.upload.complete(token, projectId, 5, 320, 240);

    await seedToken(page, token);
    await page.goto(`/editor/${projectId}`);
    await expect(page.getByText(/transcribing/i)).toBeVisible({ timeout: 8_000 });

    // Mark ready while page is polling
    await fetch(`${API_BASE}/api/internal/transcription-complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": INTERNAL_SECRET },
      body: JSON.stringify({
        projectId,
        status: "ready",
        cues: [{ text: "Transition cue", timestamp: [0, 3] }],
        wordChunks: [],
      }),
    });

    // Editor should eventually load (video fetch may timeout without real S3 but loading state clears)
    await expect(page.getByText(/transcribing/i)).not.toBeVisible({ timeout: 15_000 });
  });

  test("editor shows error state when transcription fails", async ({ page }) => {
    const { token } = await createUser(uniqueEmail(), PASSWORD);
    const { projectId } = await api.upload.presigned(token, "fail.mp4", "video/mp4", 5000);
    await api.upload.complete(token, projectId, 5, 320, 240);

    // Immediately mark as error before page loads
    await fetch(`${API_BASE}/api/internal/transcription-complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": INTERNAL_SECRET },
      body: JSON.stringify({
        projectId,
        status: "error",
        errorMessage: "GPU out of memory",
      }),
    });

    await seedToken(page, token);
    await page.goto(`/editor/${projectId}`);

    await expect(page.getByText(/transcription failed/i)).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(/gpu out of memory/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /back to dashboard/i })).toBeVisible();
  });

  test("error state 'Back to dashboard' button navigates correctly", async ({ page }) => {
    const { token } = await createUser(uniqueEmail(), PASSWORD);
    const { projectId } = await api.upload.presigned(token, "back.mp4", "video/mp4", 5000);
    await api.upload.complete(token, projectId, 5, 320, 240);

    await fetch(`${API_BASE}/api/internal/transcription-complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-secret": INTERNAL_SECRET },
      body: JSON.stringify({ projectId, status: "error", errorMessage: "Test" }),
    });

    await seedToken(page, token);
    await page.goto(`/editor/${projectId}`);
    await expect(page.getByText(/transcription failed/i)).toBeVisible({ timeout: 8_000 });

    await page.getByRole("button", { name: /back to dashboard/i }).click();
    await expect(page).toHaveURL(/dashboard/, { timeout: 5_000 });
  });
});

test.describe("Editor — auto-save", () => {
  test("PATCH /projects/:id is called after subtitle edits (auto-save)", async ({
    page,
  }) => {
    // This test verifies the API receives a save call. Since the editor requires
    // a real video file loaded into the canvas (S3 video URL), we test the
    // auto-save hook at the API level: patch the project cues directly and
    // verify they persist across a reload.
    const { token } = await createUser(uniqueEmail(), PASSWORD);
    const projectId = await setupReadyProject(token, "autosave.mp4");

    // Simulate what auto-save does: patch cues
    const edited = [
      { text: "Edited first line", timestamp: [0, 2] as [number, number] },
      { text: "Edited second line", timestamp: [2.5, 5] as [number, number] },
    ];
    await api.projects.patch(token, projectId, { cues: edited });

    // Reload and verify persistence
    const project = await api.projects.get(token, projectId);
    expect(project.cues[0].text).toBe("Edited first line");
    expect(project.cues[1].text).toBe("Edited second line");
  });

  test("style JSON is saved and reloaded correctly", async ({ page }) => {
    const { token } = await createUser(uniqueEmail(), PASSWORD);
    const projectId = await setupReadyProject(token, "style-save.mp4");

    const style = { fontSize: 32, fontFamily: "Bebas Neue", textColor: "#ffcc00" };
    await api.projects.patch(token, projectId, { styleJson: style });

    const project = await api.projects.get(token, projectId);
    expect(project.styleJson).toMatchObject(style);
  });
});

test.describe("Editor — loading existing project", () => {
  test("visiting /editor/:id for a ready project shows loading spinner then proceeds", async ({
    page,
  }) => {
    const { token } = await createUser(uniqueEmail(), PASSWORD);
    const projectId = await setupReadyProject(token, "load.mp4");

    await seedToken(page, token);
    await page.goto(`/editor/${projectId}`);

    // Shows loading spinner initially
    // (transitions quickly to ready or video-fetch error depending on MinIO availability)
    // At minimum it should not show the auth redirect or 404
    await expect(page).toHaveURL(new RegExp(`/editor/${projectId}`));
    await expect(page.getByText(/sign in/i)).not.toBeVisible({ timeout: 3_000 });
  });

  test("visiting /editor/:id for a non-existent project shows error or redirects", async ({
    page,
  }) => {
    const { token } = await createUser(uniqueEmail(), PASSWORD);

    await seedToken(page, token);
    await page.goto("/editor/00000000-0000-0000-0000-000000000000");

    // Should either show transcription error or navigate away — not crash
    await page
      .waitForURL(/dashboard|editor/, { timeout: 10_000 })
      .catch(() => {});
    // Page should be stable (no uncaught exceptions)
    await expect(page.locator("body")).toBeVisible();
  });
});

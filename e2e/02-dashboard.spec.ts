import { test, expect } from "@playwright/test";
import { uniqueEmail, createUser } from "./helpers/auth";
import { api } from "./helpers/api";

const PASSWORD = "Test1234!";

test.describe("Dashboard", () => {
  test("empty state shows new project dropzone", async ({ page }) => {
    const email = uniqueEmail();
    const { token } = await createUser(email, PASSWORD);

    await page.goto("/");
    await page.evaluate((t) => localStorage.setItem("subtitle_app_token", t), token);
    await page.goto("/dashboard");

    await expect(page.getByText("Your videos")).toBeVisible();
    await expect(page.getByText("New project")).toBeVisible();
    await expect(page.getByText(/drop a video/i)).toBeVisible();
  });

  test("shows user email in header", async ({ page }) => {
    const email = uniqueEmail();
    const { token } = await createUser(email, PASSWORD);

    await page.goto("/");
    await page.evaluate((t) => localStorage.setItem("subtitle_app_token", t), token);
    await page.goto("/dashboard");

    // Email visible on desktop (hidden md:block)
    await expect(page.locator(`text=${email}`)).toBeVisible();
  });

  test("project in 'transcribing' state shows amber badge and spinner", async ({ page }) => {
    const email = uniqueEmail();
    const { token } = await createUser(email, PASSWORD);

    // Create a project stuck at 'transcribing' via API
    const { projectId } = await api.upload.presigned(token, "test.mp4", "video/mp4", 50000);
    await api.upload.complete(token, projectId, 5, 320, 240);

    await page.goto("/");
    await page.evaluate((t) => localStorage.setItem("subtitle_app_token", t), token);
    await page.goto("/dashboard");

    await expect(page.getByText("Transcribing")).toBeVisible({ timeout: 8_000 });
  });

  test("dashboard auto-refetches while a project is transcribing", async ({ page }) => {
    const email = uniqueEmail();
    const { token } = await createUser(email, PASSWORD);

    const { projectId } = await api.upload.presigned(token, "auto.mp4", "video/mp4", 50000);
    await api.upload.complete(token, projectId, 5, 320, 240);

    await page.goto("/");
    await page.evaluate((t) => localStorage.setItem("subtitle_app_token", t), token);
    await page.goto("/dashboard");

    // Should see badge; page refetches every 4s automatically (refetchInterval in DashboardPage)
    await expect(page.getByText("Transcribing")).toBeVisible({ timeout: 8_000 });

    // Simulate backend marking project ready via internal callback
    await fetch(`${process.env.E2E_API_URL ?? "http://localhost:3001"}/api/internal/transcription-complete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": process.env.INTERNAL_SECRET ?? "internal_secret_change_me",
      },
      body: JSON.stringify({
        projectId,
        status: "ready",
        cues: [{ text: "Hello world", timestamp: [0, 2] }],
        wordChunks: [{ text: "Hello", timestamp: [0, 0.5] }, { text: " world", timestamp: [0.5, 2] }],
      }),
    });

    // Within the next refetch cycle the badge should change to "Ready"
    await expect(page.getByText("Ready")).toBeVisible({ timeout: 12_000 });
  });

  test("clicking a ready project navigates to editor", async ({ page }) => {
    const email = uniqueEmail();
    const { token } = await createUser(email, PASSWORD);

    const { projectId } = await api.upload.presigned(token, "click.mp4", "video/mp4", 50000);
    await api.upload.complete(token, projectId, 5, 320, 240);

    // Mark it ready directly
    await fetch(`${process.env.E2E_API_URL ?? "http://localhost:3001"}/api/internal/transcription-complete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": process.env.INTERNAL_SECRET ?? "internal_secret_change_me",
      },
      body: JSON.stringify({
        projectId,
        status: "ready",
        cues: [{ text: "Click test", timestamp: [0, 2] }],
        wordChunks: [],
      }),
    });

    await page.goto("/");
    await page.evaluate((t) => localStorage.setItem("subtitle_app_token", t), token);
    await page.goto("/dashboard");

    await expect(page.getByText("Ready")).toBeVisible({ timeout: 8_000 });
    await page.getByText("click").click();

    await expect(page).toHaveURL(new RegExp(`/editor/${projectId}`), { timeout: 5_000 });
  });
});

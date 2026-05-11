import { Page, expect } from "@playwright/test";
import { randomUUID } from "crypto";

const API_BASE = process.env.E2E_API_URL ?? "http://localhost:3001";

export function uniqueEmail() {
  return `test+${randomUUID().slice(0, 8)}@e2e.test`;
}

/** Register a new user via the API directly (faster than UI flow). */
export async function createUser(email: string, password: string) {
  const res = await fetch(`${API_BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`createUser failed: ${res.status} ${await res.text()}`);
  return res.json() as Promise<{ token: string; user: { id: string; email: string } }>;
}

/** Seed localStorage with a valid token so the page loads already authenticated. */
export async function loginAs(page: Page, token: string) {
  await page.goto("/");
  await page.evaluate((t) => localStorage.setItem("subtitle_app_token", t), token);
}

/** Full UI login flow. */
export async function loginViaUI(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/dashboard/, { timeout: 10_000 });
}

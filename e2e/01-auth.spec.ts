import { test, expect } from "@playwright/test";
import { uniqueEmail, createUser } from "./helpers/auth";

const PASSWORD = "Test1234!";

test.describe("Authentication", () => {
  test("signup → redirects to dashboard", async ({ page }) => {
    const email = uniqueEmail();
    await page.goto("/signup");

    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Confirm password").fill(PASSWORD);
    await page.getByRole("button", { name: /create account/i }).click();

    await expect(page).toHaveURL(/dashboard/, { timeout: 10_000 });
    await expect(page.getByText("Your videos")).toBeVisible();
  });

  test("login with valid credentials → dashboard", async ({ page }) => {
    const email = uniqueEmail();
    await createUser(email, PASSWORD);

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page).toHaveURL(/dashboard/, { timeout: 10_000 });
  });

  test("login with wrong password → shows error", async ({ page }) => {
    const email = uniqueEmail();
    await createUser(email, PASSWORD);

    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("wrongpassword");
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page.getByText(/invalid email or password/i)).toBeVisible();
    await expect(page).toHaveURL(/login/);
  });

  test("signup with mismatched passwords → shows error", async ({ page }) => {
    await page.goto("/signup");
    await page.getByLabel("Email").fill(uniqueEmail());
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Confirm password").fill("DifferentPassword1!");
    await page.getByRole("button", { name: /create account/i }).click();

    await expect(page.getByText(/do not match/i)).toBeVisible();
  });

  test("signup with duplicate email → shows error", async ({ page }) => {
    const email = uniqueEmail();
    await createUser(email, PASSWORD);

    await page.goto("/signup");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Confirm password").fill(PASSWORD);
    await page.getByRole("button", { name: /create account/i }).click();

    await expect(page.getByText(/already registered/i)).toBeVisible();
  });

  test("unauthenticated visit to /dashboard → redirects to /login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/login/, { timeout: 5_000 });
  });

  test("sign out → redirects to /login", async ({ page }) => {
    const email = uniqueEmail();
    const { token } = await createUser(email, PASSWORD);

    await page.goto("/");
    await page.evaluate((t) => localStorage.setItem("subtitle_app_token", t), token);
    await page.goto("/dashboard");
    await expect(page.getByText("Your videos")).toBeVisible();

    await page.getByRole("button", { name: /sign out/i }).click();
    await expect(page).toHaveURL(/login/, { timeout: 5_000 });

    // Token cleared from localStorage
    const stored = await page.evaluate(() => localStorage.getItem("subtitle_app_token"));
    expect(stored).toBeNull();
  });
});

/// <reference types="vite-plugin-pwa/client" />
import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import {
  createRouter,
  createRootRoute,
  createRoute,
  RouterProvider,
  Navigate,
  Outlet,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserNotSupported, isBrowserSupported } from "./BrowserNotSupported";
import { ErrorBoundary } from "./ErrorBoundary";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { registerSW } from "virtual:pwa-register";
import * as Sentry from "@sentry/react";

const LoginPage = React.lazy(() => import("./screens/auth/LoginPage"));
const SignupPage = React.lazy(() => import("./screens/auth/SignupPage"));
const DashboardPage = React.lazy(() => import("./screens/dashboard/DashboardPage"));
const EditorPage = React.lazy(() => import("./EditorPage"));

// ── Auth guard layout ─────────────────────────────────────────────────────────

function AuthGuard() {
  const { user, isLoading } = useAuth();
  if (isLoading) {
    return (
      <div className="flex h-dvh items-center justify-center bg-zinc-900">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
      </div>
    );
  }
  if (!user) {
    const redirect = encodeURIComponent(window.location.pathname);
    return <Navigate to={`/login?redirect=${redirect}`} />;
  }
  return <Outlet />;
}

// ── Routes ────────────────────────────────────────────────────────────────────

const rootRoute = createRootRoute({ component: Outlet });

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: () => (
    <React.Suspense fallback={<PageLoader />}>
      <LoginPage />
    </React.Suspense>
  ),
});

const signupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/signup",
  component: () => (
    <React.Suspense fallback={<PageLoader />}>
      <SignupPage />
    </React.Suspense>
  ),
});

const guardRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "auth-guard",
  component: AuthGuard,
});

const dashboardRoute = createRoute({
  getParentRoute: () => guardRoute,
  path: "/dashboard",
  component: () => (
    <React.Suspense fallback={<PageLoader />}>
      <DashboardPage />
    </React.Suspense>
  ),
});

const editorRoute = createRoute({
  getParentRoute: () => guardRoute,
  path: "/editor/$projectId",
  component: () => (
    <React.Suspense fallback={<PageLoader />}>
      <EditorPage />
    </React.Suspense>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => guardRoute,
  path: "/",
  component: () => <Navigate to="/dashboard" />,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  signupRoute,
  guardRoute.addChildren([indexRoute, dashboardRoute, editorRoute]),
]);

const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

// ── Query client ──────────────────────────────────────────────────────────────

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

// ── Misc ──────────────────────────────────────────────────────────────────────

function PageLoader() {
  return (
    <div className="flex h-dvh items-center justify-center bg-zinc-900">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
    </div>
  );
}

if (import.meta.env.PROD) {
  registerSW({
    immediate: false,
    onRegisteredSW(swUrl) {
      console.log("SW registered:", swUrl);
    },
    onRegisterError(error) {
      console.error("SW registration error:", error);
    },
  });
}

Sentry.init({
  dsn: "https://c0ff8dd14d638c4e77dfa9c25e4bd42d@o464504.ingest.us.sentry.io/4508197084725248",
  integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration()],
  tracesSampleRate: 1.0,
  tracePropagationTargets: ["localhost", /^https:\/\/subtitles\.fframes\.studio/],
  enabled: process.env.NODE_ENV !== "development",
  replaysSessionSampleRate: 0.05,
  replaysOnErrorSampleRate: 1.0,
  ignoreErrors: [
    "ControlLooksLikePasswordCredentialField",
    "ResizeObserver loop limit exceeded",
    "ResizeObserver loop completed with undelivered notifications",
    /^chrome-extension:\/\//,
    /^moz-extension:\/\//,
  ],
  beforeSend(event) {
    if (
      event.exception?.values?.[0]?.stacktrace?.frames?.some(
        (f) =>
          f.filename?.includes("extension") ||
          f.filename?.startsWith("chrome-extension://") ||
          f.filename?.startsWith("moz-extension://")
      )
    )
      return null;
    return event;
  },
});

// ── Bootstrap ─────────────────────────────────────────────────────────────────

const rootElement = document.querySelector("#root");
if (rootElement) {
  const root = ReactDOM.createRoot(rootElement);
  const browserFeatures = isBrowserSupported();
  root.render(
    <React.StrictMode>
      <ErrorBoundary>
        {browserFeatures === true ? (
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <RouterProvider router={router} />
            </AuthProvider>
          </QueryClientProvider>
        ) : (
          <BrowserNotSupported features={browserFeatures} />
        )}
      </ErrorBoundary>
    </React.StrictMode>
  );
}

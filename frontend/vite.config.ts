import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import react from "@vitejs/plugin-react";
import path from "path";

// @rescript/core ships .mjs files but rescript compiles imports as .res.mjs
function rescriptCoreAlias(): Plugin {
  return {
    name: "rescript-core-alias",
    resolveId(id) {
      if (id.includes("@rescript/core") && id.endsWith(".res.mjs")) {
        return id.replace(/\.res\.mjs$/, ".mjs");
      }
    },
  };
}

const ReactCompilerConfig = {
  target: "19",
};

export default defineConfig(({ mode }) => ({
  plugins: [
    rescriptCoreAlias(),
    react({
      include: ["**/*.res.mjs", "**/*.tsx", "**/*.ts"],
      babel: {
        plugins: [["babel-plugin-react-compiler", ReactCompilerConfig]],
        targets: {
          browsers: [
            "chrome >= 94",
            "edge >= 94",
            "firefox >= 100",
            "safari >= 16.4",
          ],
        },
      },
    }),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: mode === "production" ? "auto" : false,
      workbox: {
        maximumFileSizeToCacheInBytes: 10 * 1024 * 1024,
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2,ttf}"],
      },
    }),
  ],
  resolve: {
    alias: {
      // Use modern ESM build instead of ES5 transpiled version
      "workbox-window": path.resolve(
        __dirname,
        "node_modules/workbox-window/build/workbox-window.prod.mjs"
      ),
    },
  },
  server: {
    proxy: {
      "/api": {
        target: process.env.VITE_API_BASE_URL ?? "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "esnext",
  },
}));

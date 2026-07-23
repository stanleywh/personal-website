import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: process.env.GITHUB_ACTIONS ? "/personal-website/" : "/",
  build: {
    rollupOptions: {
      input: {
        home: resolve(__dirname, "index.html"),
        account: resolve(__dirname, "account.html"),
        tracker: resolve(__dirname, "tracker.html"),
        finances: resolve(__dirname, "finances.html"),
        projects: resolve(__dirname, "projects.html"),
        about: resolve(__dirname, "about.html"),
      },
    },
  },
  test: {
    environment: "jsdom",
  },
});

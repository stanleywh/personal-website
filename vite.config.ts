import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "/",
  build: {
    rollupOptions: {
      input: {
        home: resolve(__dirname, "index.html"),
        account: resolve(__dirname, "account/index.html"),
        tracker: resolve(__dirname, "tracker/index.html"),
        about: resolve(__dirname, "about/index.html"),
      },
    },
  },
  test: {
    environment: "jsdom",
  },
});

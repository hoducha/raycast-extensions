import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@raycast/api": resolve(__dirname, "src/__mocks__/@raycast/api.ts"),
    },
  },
  test: {
    environment: "node",
  },
});

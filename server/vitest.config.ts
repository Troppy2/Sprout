import { defineConfig } from "vitest/config";

// Layer 1 (unit) and layer 2 (protocol) tests. See .claude/docs/reference/testing.md.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 15000,
  },
});

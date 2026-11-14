import { defineConfig } from "vitest/config";

// Extension unit tests: tools and lib code run against an in-memory fake of the
// chrome.* APIs (tests/helpers/fake-chrome.ts). No browser. Real Chrome is
// layer 3. See .claude/docs/reference/testing.md.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    testTimeout: 10000,
  },
});

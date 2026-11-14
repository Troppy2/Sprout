import { vi } from "vitest";
import { createFakeChrome, type FakeChrome } from "./fake-chrome";

/**
 * Installs a fresh fake `chrome` and clears the module cache. Modules register
 * chrome listeners when they load, so import the module under test after this.
 */
export function freshChrome(): FakeChrome {
  const fake = createFakeChrome();
  vi.stubGlobal("chrome", fake.chrome);
  vi.resetModules();
  return fake;
}

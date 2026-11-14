/**
 * A small in-memory stand-in for the `chrome.*` APIs the worker uses. It keeps
 * real state (tabs, groups, storage, attached debuggers) so tools can be driven
 * end to end without a browser. It is not a full Chrome: add behavior only when a
 * test needs it, and keep it close to what Chrome actually does.
 */
import { vi } from "vitest";

type Listener = (...args: any[]) => unknown;

export interface FakeEvent {
  addListener: (listener: Listener) => void;
  removeListener: (listener: Listener) => void;
  hasListener: (listener: Listener) => boolean;
  emit: (...args: unknown[]) => void;
  listeners: Set<Listener>;
}

function fakeEvent(): FakeEvent {
  const listeners = new Set<Listener>();
  return {
    listeners,
    addListener: (listener) => void listeners.add(listener),
    removeListener: (listener) => void listeners.delete(listener),
    hasListener: (listener) => listeners.has(listener),
    emit: (...args) => {
      for (const listener of [...listeners]) listener(...args);
    },
  };
}

function fakeStorageArea() {
  const data = new Map<string, unknown>();
  return {
    data,
    get: vi.fn(async (keys?: string | string[]) => {
      const wanted = keys === undefined ? [...data.keys()] : Array.isArray(keys) ? keys : [keys];
      const out: Record<string, unknown> = {};
      for (const key of wanted) if (data.has(key)) out[key] = data.get(key);
      return out;
    }),
    set: vi.fn(async (items: Record<string, unknown>) => {
      for (const [key, value] of Object.entries(items)) data.set(key, value);
    }),
    remove: vi.fn(async (keys: string | string[]) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) data.delete(key);
    }),
    setAccessLevel: vi.fn(async () => {}),
  };
}

export interface FakeTab {
  id: number;
  url: string;
  title: string;
  groupId: number;
  status: "loading" | "complete";
  history: string[];
}

/** Schemes Chrome refuses to attach the debugger to. */
const UNATTACHABLE = /^(chrome|chrome-error|chrome-extension|devtools|edge|view-source):/;

export function createFakeChrome() {
  const tabs = new Map<number, FakeTab>();
  const groups = new Map<number, { id: number; title: string; color: string }>();
  const attached = new Set<number>();
  /** CDP methods that never answer, to test timeouts. */
  const hang = new Set<string>();
  /** Viewport in CSS pixels plus the device pixel ratio, for screenshots. */
  const layout = { cssWidth: 1000, cssHeight: 800, dpr: 1 };
  /** The network as the fake sees it. Tests add redirects, DNS answers and response headers. */
  const net = {
    /** url -> Location of a 302 */
    redirects: new Map<string, string>(),
    /** hostname -> IP. Unlisted names resolve to a public address. */
    dns: new Map<string, string>(),
    /** url -> response headers. Default: text/html. */
    responses: new Map<string, Array<{ name: string; value: string }>>(),
    /** Every URL a request was actually sent for (continued at the request stage). */
    sent: [] as string[],
  };
  /** Tabs with Fetch interception on. */
  const fetchEnabled = new Set<number>();
  const pausedRequests = new Map<string, (decision: "continue" | "fail") => void>();
  let nextRequestId = 1;
  let nextTabId = 100;
  let nextGroupId = 1;

  const onUpdated = fakeEvent();
  const onRemoved = fakeEvent();
  const onEvent = fakeEvent();
  const onDetach = fakeEvent();

  const snapshot = (tab: FakeTab) => ({ ...tab, history: undefined });

  function requireTab(tabId: number): FakeTab {
    const tab = tabs.get(tabId);
    if (!tab) throw new Error(`No tab with id: ${tabId}.`);
    return tab;
  }

  /** Simulates a page load: loading, then complete, on later ticks. */
  function load(tab: FakeTab, url: string): void {
    tab.url = url;
    tab.status = "loading";
    tab.history.push(url);
    setTimeout(() => {
      onUpdated.emit(tab.id, { status: "loading", url }, snapshot(tab));
      if (attached.has(tab.id)) onEvent.emit({ tabId: tab.id }, "Page.frameNavigated", { frame: { id: "main", url } });
      setTimeout(() => {
        tab.status = "complete";
        tab.title = `Title of ${url}`;
        onUpdated.emit(tab.id, { status: "complete" }, snapshot(tab));
        if (attached.has(tab.id)) onEvent.emit({ tabId: tab.id }, "Page.loadEventFired", {});
      }, 0);
    }, 0);
  }

  function ipFor(url: string): string {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
    if (/^[\d.]+$/.test(host) || host.includes(":")) return host;
    return net.dns.get(host) ?? "93.184.216.34";
  }

  /** Emits Fetch.requestPaused and waits for the extension's continue or fail. */
  function pause(
    tabId: number,
    url: string,
    response?: { status: number; headers: Array<{ name: string; value: string }> },
  ): Promise<"continue" | "fail"> {
    return new Promise((resolve) => {
      const requestId = `interception-${nextRequestId++}`;
      pausedRequests.set(requestId, (decision) => {
        if (!response && decision === "continue") net.sent.push(url);
        resolve(decision);
      });
      onEvent.emit({ tabId }, "Fetch.requestPaused", {
        requestId,
        request: { url },
        resourceType: "Document",
        frameId: "main",
        ...(response ? { responseStatusCode: response.status, responseHeaders: response.headers } : {}),
      });
    });
  }

  /**
   * Page.navigate with interception on: each hop pauses at the request stage,
   * each response (redirects included) at the response stage, like Chrome.
   */
  async function guardedNavigate(tab: FakeTab, url: string): Promise<Record<string, unknown>> {
    let current = url;
    for (let hop = 0; hop < 10; hop++) {
      if ((await pause(tab.id, current)) === "fail") return { frameId: "main", errorText: "net::ERR_BLOCKED_BY_CLIENT" };

      const location = net.redirects.get(current);
      if (location) {
        const decision = await pause(tab.id, current, { status: 302, headers: [{ name: "Location", value: location }] });
        if (decision === "fail") return { frameId: "main", errorText: "net::ERR_BLOCKED_BY_CLIENT" };
        current = location;
        continue;
      }

      const headers = net.responses.get(current) ?? [
        { name: "Content-Type", value: /\.exe$/.test(current) ? "application/octet-stream" : "text/html" },
      ];
      if ((await pause(tab.id, current, { status: 200, headers })) === "fail") {
        return { frameId: "main", errorText: "net::ERR_BLOCKED_BY_CLIENT" };
      }

      onEvent.emit({ tabId: tab.id }, "Network.responseReceived", {
        type: "Document",
        frameId: "main",
        response: { url: current, remoteIPAddress: ipFor(current) },
      });
      load(tab, current);
      return { frameId: "main" };
    }
    return { frameId: "main", errorText: "net::ERR_TOO_MANY_REDIRECTS" };
  }

  const chromeApi = {
    runtime: {
      id: "fakeextensionidfakeextensionidab",
      onMessage: fakeEvent(),
      onStartup: fakeEvent(),
      onInstalled: fakeEvent(),
      sendMessage: vi.fn(async () => undefined),
    },
    alarms: {
      create: vi.fn(async () => {}),
      get: vi.fn(async () => undefined),
      onAlarm: fakeEvent(),
    },
    storage: {
      local: fakeStorageArea(),
      session: fakeStorageArea(),
      onChanged: fakeEvent(),
    },
    downloads: {
      onDeterminingFilename: fakeEvent(),
      onCreated: fakeEvent(),
      cancel: vi.fn(async (_id: number) => {}),
    },
    tabs: {
      onUpdated,
      onRemoved,
      get: vi.fn(async (tabId: number) => snapshot(requireTab(tabId))),
      query: vi.fn(async (info: { groupId?: number }) =>
        [...tabs.values()].filter((tab) => info.groupId === undefined || tab.groupId === info.groupId).map(snapshot),
      ),
      create: vi.fn(async ({ url = "about:blank" }: { url?: string }) => {
        const tab: FakeTab = { id: nextTabId++, url: "", title: "", groupId: -1, status: "loading", history: [] };
        tabs.set(tab.id, tab);
        load(tab, url);
        return snapshot(tab);
      }),
      update: vi.fn(async (tabId: number, props: { url?: string }) => {
        const tab = requireTab(tabId);
        if (props.url !== undefined) load(tab, props.url);
        return snapshot(tab);
      }),
      remove: vi.fn(async (tabId: number) => {
        tabs.delete(tabId);
        attached.delete(tabId);
        onRemoved.emit(tabId, {});
      }),
      group: vi.fn(async ({ tabIds, groupId }: { tabIds: number[]; groupId?: number }) => {
        let id = groupId;
        if (id === undefined) {
          id = nextGroupId++;
          groups.set(id, { id, title: "", color: "grey" });
        } else if (!groups.has(id)) {
          throw new Error(`No group with id: ${id}.`);
        }
        for (const tabId of tabIds) requireTab(tabId).groupId = id;
        return id;
      }),
    },
    tabGroups: {
      get: vi.fn(async (groupId: number) => {
        const group = groups.get(groupId);
        if (!group) throw new Error(`No group with id: ${groupId}.`);
        return { ...group };
      }),
      query: vi.fn(async (info: { title?: string }) =>
        [...groups.values()].filter((group) => info.title === undefined || group.title === info.title),
      ),
      update: vi.fn(async (groupId: number, props: { title?: string; color?: string }) => {
        const group = groups.get(groupId);
        if (!group) throw new Error(`No group with id: ${groupId}.`);
        Object.assign(group, props);
        return { ...group };
      }),
    },
    debugger: {
      onEvent,
      onDetach,
      attach: vi.fn(async ({ tabId }: { tabId: number }) => {
        const tab = requireTab(tabId);
        if (UNATTACHABLE.test(tab.url)) {
          throw new Error(`Cannot access a ${tab.url.split(":")[0]}:// URL of different extension`);
        }
        if (attached.has(tabId)) throw new Error("Another debugger is already attached to the tab");
        attached.add(tabId);
      }),
      detach: vi.fn(async ({ tabId }: { tabId: number }) => {
        if (!attached.delete(tabId)) throw new Error("Debugger is not attached to the tab");
        // Detaching ends the session, and every domain it enabled with it.
        fetchEnabled.delete(tabId);
      }),
      getTargets: vi.fn(async () => [...attached].map((tabId) => ({ tabId, attached: true }))),
      sendCommand: vi.fn(async ({ tabId }: { tabId: number }, method: string, params: Record<string, any> = {}) => {
        if (!attached.has(tabId)) throw new Error("Debugger is not attached to the tab");
        const tab = requireTab(tabId);

        if (hang.has(method)) return new Promise(() => {});

        switch (method) {
          case "Page.enable":
          case "Network.enable":
          case "Page.stopLoading":
            return {};
          case "Fetch.enable":
            fetchEnabled.add(tabId);
            return {};
          case "Fetch.continueRequest":
          case "Fetch.failRequest": {
            const settle = pausedRequests.get(params.requestId);
            if (!settle) throw new Error(`Invalid InterceptionId: ${params.requestId}`);
            pausedRequests.delete(params.requestId);
            settle(method === "Fetch.continueRequest" ? "continue" : "fail");
            return {};
          }
          case "Page.navigate":
            // about:blank fetches nothing, so there is nothing to intercept.
            if (params.url === "about:blank" || !fetchEnabled.has(tabId)) {
              // Without interception Chrome reports a download through isDownload.
              if (/\.exe$/.test(params.url)) return { frameId: "main", isDownload: true };
              load(tab, params.url);
              return { frameId: "main" };
            }
            return guardedNavigate(tab, params.url);
          case "Page.getLayoutMetrics": {
            // css* is in CSS pixels; the deprecated unprefixed fields are in device pixels.
            const css = { pageX: 0, pageY: 0, clientWidth: layout.cssWidth, clientHeight: layout.cssHeight };
            return {
              cssVisualViewport: css,
              cssLayoutViewport: css,
              visualViewport: {
                pageX: 0,
                pageY: 0,
                clientWidth: layout.cssWidth * layout.dpr,
                clientHeight: layout.cssHeight * layout.dpr,
              },
            };
          }
          case "Page.captureScreenshot":
            return { data: "ZmFrZQ==" };
          case "Page.getNavigationHistory":
            return {
              currentIndex: tab.history.length - 1,
              entries: tab.history.map((url, id) => ({ id, url })),
            };
          default:
            throw new Error(`fake chrome: ${method} is not implemented`);
        }
      }),
    },
  };

  /** Test setup: a tab already sitting in the green Sprout group. */
  async function addSproutTab(url: string): Promise<number> {
    const id = nextTabId++;
    tabs.set(id, { id, url, title: "", groupId: -1, status: "complete", history: [url] });

    let group = [...groups.values()].find((g) => g.title === "Sprout" && g.color === "green");
    if (!group) {
      group = { id: nextGroupId++, title: "Sprout", color: "green" };
      groups.set(group.id, group);
    }
    requireTab(id).groupId = group.id;
    await chromeApi.storage.session.set({ groupId: group.id });
    return id;
  }

  /** Test setup: the user (or a page script) moves a tab while nothing is watching. */
  function moveTabSilently(tabId: number, url: string): void {
    const tab = requireTab(tabId);
    tab.url = url;
    tab.history.push(url);
  }

  return { chrome: chromeApi, tabs, groups, attached, fetchEnabled, net, hang, layout, addSproutTab, moveTabSilently };
}

export type FakeChrome = ReturnType<typeof createFakeChrome>;

import type { DiaryMode } from "../types/database";

const BLOCK_MESSAGE = "Traditional mode does not allow network access.";

let installed = false;
let originalFetch: typeof window.fetch | null = null;
let originalXhrOpen: typeof XMLHttpRequest.prototype.open | null = null;
let originalWebSocket: typeof WebSocket | null = null;
let onBlocked: ((message: string) => void) | null = null;

function notifyBlocked() {
  if (onBlocked) {
    onBlocked(BLOCK_MESSAGE);
  }
}

function blockFetch() {
  if (typeof window.fetch !== "function") {
    return;
  }
  if (!originalFetch) {
    originalFetch = window.fetch.bind(window);
  }
  window.fetch = ((..._args: Parameters<typeof window.fetch>) => {
    notifyBlocked();
    return Promise.reject(new Error(BLOCK_MESSAGE));
  }) as typeof window.fetch;
}

function blockXhr() {
  if (typeof XMLHttpRequest === "undefined") {
    return;
  }
  if (!originalXhrOpen) {
    originalXhrOpen = XMLHttpRequest.prototype.open;
  }
  XMLHttpRequest.prototype.open = function (
    ..._args: Parameters<XMLHttpRequest["open"]>
  ) {
    notifyBlocked();
    throw new Error(BLOCK_MESSAGE);
  };
}

function blockWebSocket() {
  if (typeof window.WebSocket === "undefined") {
    return;
  }
  if (!originalWebSocket) {
    originalWebSocket = window.WebSocket;
  }
  const BlockedWebSocket = function (
    ..._args: ConstructorParameters<typeof WebSocket>
  ) {
    notifyBlocked();
    throw new Error(BLOCK_MESSAGE);
  } as unknown as typeof WebSocket;
  BlockedWebSocket.prototype = originalWebSocket.prototype;
  const constants = ["CONNECTING", "OPEN", "CLOSING", "CLOSED"] as const;
  for (const key of constants) {
    try {
      Object.defineProperty(BlockedWebSocket, key, {
        value: originalWebSocket[key],
        writable: false
      });
    } catch {
      continue;
    }
  }
  window.WebSocket = BlockedWebSocket;
}

function restoreNetwork() {
  if (originalFetch) {
    window.fetch = originalFetch;
  }
  if (originalXhrOpen) {
    XMLHttpRequest.prototype.open = originalXhrOpen;
  }
  if (originalWebSocket) {
    window.WebSocket = originalWebSocket;
  }
}

export function installNetworkGuard(
  mode: DiaryMode,
  onBlockedHandler?: (message: string) => void
) {
  onBlocked = onBlockedHandler ?? null;
  if (mode === "traditional") {
    if (!installed) {
      installed = true;
    }
    blockFetch();
    blockXhr();
    blockWebSocket();
    return;
  }
  restoreNetwork();
}

export { BLOCK_MESSAGE };

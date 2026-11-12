import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import { backend } from "./mocks/decky-api";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

if (!(globalThis as any).CSS) (globalThis as any).CSS = {};
if (!(globalThis as any).CSS.escape) (globalThis as any).CSS.escape = (value: string) => value.replace(/["\\]/g, "\\$&");

const originalError = console.error;
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    if (String(args[0]).includes("not wrapped in act")) return;
    originalError(...args);
  });
  backend.reset();
  (window as any).SteamClient = undefined;
  (window as any).SteamUIStore = undefined;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

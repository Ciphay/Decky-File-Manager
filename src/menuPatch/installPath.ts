import { getGameInstallDir } from "../api";

const FAILURE_TTL_MS = 30_000;

type CacheEntry = { path: string | null; expiresAt: number };

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<string | null>>();

export const getInstallCacheKey = (appid?: number, name?: string) => `${typeof appid === "number" ? appid : 0}:${name?.trim() ?? ""}`;

export const getCachedInstallPath = (appid?: number, name?: string): string | null | undefined => {
  const key = getInstallCacheKey(appid, name);
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.path === null && entry.expiresAt < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.path;
};

export const isInstallPathLoading = (appid?: number, name?: string) => inflight.has(getInstallCacheKey(appid, name));

const steamClientInstallDir = (appid: number): Promise<string | null> =>
  new Promise((resolve) => {
    const getter = (window as any).SteamClient?.Apps?.GetAppInstallDir;
    if (typeof getter !== "function") {
      resolve(null);
      return;
    }
    try {
      getter.call((window as any).SteamClient.Apps, appid, (installPath: string | null | undefined) => {
        resolve(typeof installPath === "string" && installPath.trim() ? installPath.trim() : null);
      });
    } catch {
      resolve(null);
    }
  });

const resolveInstallPath = async (appid?: number, name?: string): Promise<string | null> => {
  const normalizedName = typeof name === "string" ? name.trim() : "";
  const numericAppid = typeof appid === "number" ? appid : 0;

  const backendResult = await getGameInstallDir(numericAppid, normalizedName || null);
  if (backendResult?.success && backendResult.path) {
    return backendResult.path;
  }
  return numericAppid !== 0 ? steamClientInstallDir(numericAppid) : null;
};

export const fetchInstallPath = (appid?: number, name?: string): Promise<string | null> => {
  const key = getInstallCacheKey(appid, name);
  const cached = getCachedInstallPath(appid, name);
  if (cached !== undefined) {
    return Promise.resolve(cached);
  }

  const pending = inflight.get(key);
  if (pending) {
    return pending;
  }

  const promise = resolveInstallPath(appid, name)
    .catch((): string | null => null)
    .then((path) => {
      cache.set(key, { path, expiresAt: path ? Infinity : Date.now() + FAILURE_TTL_MS });
      return path;
    })
    .finally(() => {
      inflight.delete(key);
    });

  inflight.set(key, promise);
  return promise;
};

type Registration = { unregister?: () => void; Unregister?: () => void } | (() => void) | null | undefined;

export const unregisterSteamCallback = (registration: Registration): void => {
  try {
    if (typeof registration === "function") registration();
    else if (registration?.unregister) registration.unregister();
    else if (registration?.Unregister) registration.Unregister();
  } catch (e) {
    console.warn("Decky File Manager: failed to unregister Steam input callback", e);
  }
};

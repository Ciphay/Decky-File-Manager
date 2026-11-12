export const isGamepadUi = (): boolean => Boolean((window as any).SteamUIStore?.WindowStore?.GamepadUIMainWindowInstance);

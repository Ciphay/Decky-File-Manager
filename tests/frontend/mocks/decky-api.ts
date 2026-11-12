import { vi } from "vitest";

type Impl = (...args: any[]) => any;

class FakeBackend {
  private impls = new Map<string, Impl>();
  calls: Array<{ name: string; args: any[] }> = [];

  on(name: string, impl: Impl) {
    this.impls.set(name, impl);
  }

  reset() {
    this.impls.clear();
    this.calls = [];
  }

  callsTo(name: string) {
    return this.calls.filter((call) => call.name === name).map((call) => call.args);
  }

  invoke(name: string, args: any[]) {
    this.calls.push({ name, args });
    const impl = this.impls.get(name);
    if (!impl) return Promise.reject(new Error(`sem implementação para ${name}`));
    try {
      return Promise.resolve(impl(...args));
    } catch (error) {
      return Promise.reject(error);
    }
  }
}

export const backend = new FakeBackend();

export const callable = <_A extends any[] = any[], _R = any>(name: string) => (...args: any[]) => backend.invoke(name, args) as Promise<any>;

export const toaster = { toast: vi.fn() };

export const routerHook = { addRoute: vi.fn(), removeRoute: vi.fn() };

export const useQuickAccessVisible = vi.fn(() => false);

export const definePlugin = (fn: (...args: any[]) => any) => fn;

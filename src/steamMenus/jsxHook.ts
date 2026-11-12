import { findModule } from "@decky/ui";

type AnyFn = (...args: any[]) => any;

export type ComponentRule = {
  matchesProps: (props: any) => boolean;
  matchesSource: (source: string) => boolean;
  wrap: (original: AnyFn) => AnyFn;
};

const findJsxRuntime = (): { jsx: AnyFn; jsxs: AnyFn } | undefined =>
  findModule((candidate: any) => typeof candidate?.jsx === "function" && typeof candidate?.jsxs === "function" && candidate?.Fragment) as
    | { jsx: AnyFn; jsxs: AnyFn }
    | undefined;

const sourceOf = (fn: AnyFn): string => {
  try {
    return Function.prototype.toString.call(fn);
  } catch {
    return "";
  }
};

export function installComponentRules(rules: ComponentRule[]): () => void {
  const runtime = findJsxRuntime();
  if (!runtime) return () => undefined;

  const resolved = new WeakMap<AnyFn, AnyFn | null>();

  const resolve = (type: unknown, props: unknown): unknown => {
    if (typeof type !== "function" || !props || typeof props !== "object") return type;
    const cached = resolved.get(type as AnyFn);
    if (cached !== undefined) return cached ?? type;

    const rule = rules.find((candidate) => {
      try {
        return candidate.matchesProps(props);
      } catch {
        return false;
      }
    });
    if (!rule) return type;

    if (!rule.matchesSource(sourceOf(type as AnyFn))) {
      resolved.set(type as AnyFn, null);
      return type;
    }
    const wrapped = rule.wrap(type as AnyFn);
    Object.defineProperty(wrapped, "name", { value: (type as AnyFn).name });
    resolved.set(type as AnyFn, wrapped);
    return wrapped;
  };

  const originals = { jsx: runtime.jsx, jsxs: runtime.jsxs };
  const hook = (original: AnyFn): AnyFn => (type: unknown, props: unknown, ...rest: unknown[]) => original(resolve(type, props), props, ...rest);

  runtime.jsx = hook(originals.jsx);
  runtime.jsxs = hook(originals.jsxs);

  return () => {
    runtime.jsx = originals.jsx;
    runtime.jsxs = originals.jsxs;
  };
}

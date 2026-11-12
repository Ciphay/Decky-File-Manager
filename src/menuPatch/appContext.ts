export type AppContext = { appid?: number; name?: string };

const NAME_FIELDS = ["name", "displayName", "display_name", "title"];
const SKIPPED_KEYS = new Set(["_owner", "stateNode", "return", "alternate", "_store", "ref"]);
const MAX_DEPTH = 10;
const MAX_NODES = 4000;

const sourcesOf = (node: any): any[] => [node, node?.props, node?._owner?.pendingProps, node?._owner?.memoizedProps];

const holdersOf = (node: any): any[] =>
  sourcesOf(node)
    .flatMap((source) => [source?.overview, source?.app])
    .filter((holder) => holder && typeof holder === "object");

export const getAppContextFromNode = (node: any): AppContext | null => {
  if (!node || typeof node !== "object") {
    return null;
  }

  const holders = holdersOf(node);
  const appid = holders.map((holder) => holder.appid).find((candidate) => typeof candidate === "number");
  const name = holders
    .flatMap((holder) => NAME_FIELDS.map((field) => holder[field]))
    .find((candidate): candidate is string => typeof candidate === "string" && candidate.trim().length > 0);

  if (typeof appid === "number") {
    return { appid, name: name?.trim() || undefined };
  }
  return name ? { name: name.trim() } : null;
};

const scoreContext = (node: any, context: AppContext): number => {
  let score = 0;
  if (typeof context.appid === "number") score += 200;
  if (context.name?.trim()) score += 80;
  if (holdersOf(node).length > 0) score += 100;
  return score;
};

export const collectAppContext = (value: unknown): AppContext | null => {
  const candidates: Array<{ context: AppContext; score: number }> = [];
  const visited = new WeakSet<object>();
  let budget = MAX_NODES;

  const visit = (current: unknown, depth: number) => {
    if (!current || typeof current !== "object" || depth > MAX_DEPTH || budget-- <= 0) {
      return;
    }
    if (visited.has(current as object)) {
      return;
    }
    visited.add(current as object);

    if (Array.isArray(current)) {
      current.forEach((entry) => visit(entry, depth + 1));
      return;
    }

    const context = getAppContextFromNode(current);
    if (context) {
      candidates.push({ context, score: scoreContext(current, context) });
    }

    for (const [key, child] of Object.entries(current as Record<string, unknown>)) {
      if (!SKIPPED_KEYS.has(key)) {
        visit(child, depth + 1);
      }
    }
  };

  visit(value, 0);
  candidates.sort((left, right) => right.score - left.score);
  return candidates[0]?.context ?? null;
};

export const getMenuAppContext = (menuItems: unknown): AppContext => {
  if (!Array.isArray(menuItems)) {
    return {};
  }
  const found = collectAppContext(menuItems);
  return { appid: found?.appid, name: found?.name };
};

export const getComponentAppContext = (component: any): AppContext => getAppContextFromNode(component) ?? {};

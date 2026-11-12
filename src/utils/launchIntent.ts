export type SelectionIntent = "shortcut" | "result-file" | "text-editor";

const INTENT_TTL_MS = 5000;

let intent: { kind: SelectionIntent; at: number } | null = null;

export const setSelectionIntent = (kind: SelectionIntent | null) => {
  intent = kind ? { kind, at: Date.now() } : null;
};

export const peekSelectionIntent = (): SelectionIntent | null =>
  intent && Date.now() - intent.at < INTENT_TTL_MS ? intent.kind : null;

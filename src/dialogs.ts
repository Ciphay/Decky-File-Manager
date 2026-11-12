import { PropertiesData } from "./api";

export type Dialog =
  | { kind: "rename"; path: string; value: string }
  | { kind: "createFolder"; parentDir: string; name: string }
  | { kind: "delete"; path: string; name: string }
  | { kind: "conflict"; title: string; message: string; targetDir: string; itemName: string; isFolder: boolean }
  | { kind: "message"; title: string; message: string }
  | { kind: "properties"; data: PropertiesData; calculating: boolean }
  | { kind: "addShortcut"; path: string; name: string; error: string | null }
  | { kind: "driveRename"; device: string; value: string }
  | { kind: "password"; title: string; message: string; value: string; error: string | null; submit: (password: string) => Promise<void> };

export type DialogState = Dialog | null;

export type OperationModalState = {
  label: string;
  progress: number;
  operationId: string;
  showBackground: boolean;
  paused: boolean;
} | null;

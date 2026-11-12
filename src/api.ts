import { callable } from "@decky/api";

export type FileEntry = {
  name: string;
  path: string;
  is_dir: boolean;
  size: number | null;
  modified: number;
};

export type OperationStatus = {
  known?: boolean;
  progress: number;
  active: boolean;
  label: string;
  detail?: string;
  paused: boolean;
  cancel_requested?: boolean;
  first_item_processed?: boolean;
  target_dir?: string | null;
  failed?: boolean;
  error?: string;
};

export type PropertiesData = {
  name: string;
  path: string;
  type: "file" | "folder";
  size: number | null;
  created: number;
  modified: number;
  permissions: {
    owner: string;
    immutable: boolean;
    raw: string;
  };
};

export type PasteConflict = {
  blocked: boolean;
  reason?: string;
  needs_conflict?: boolean;
  path?: string;
  name: string;
  is_dir?: boolean;
};

export type MutationResult = {
  success?: boolean;
  ok?: boolean;
  cancelled?: boolean;
  error?: string;
  new_path?: string;
  skipped?: boolean;
  skipped_count?: number;
  skipped_items?: string[];
};

export const listDir = callable<[string], { path: string; items: FileEntry[]; success?: boolean; error?: string }>("list_dir");
export const hasClipboard = callable<[], { has: boolean }>("has_clipboard");
export const copyPath = callable<[string], { ok: boolean }>("copy_path");
export const cutPath = callable<[string], { ok: boolean }>("cut_path");
export const checkPasteConflict = callable<[string], PasteConflict>("check_paste_conflict");
export const pastePathWithOptions = callable<[string, string, boolean, string, string, string], MutationResult>("paste_path_with_options");
export const extractArchive = callable<[string, string, string, string], MutationResult>("extract_archive");
export const renamePath = callable<[string, string, string], MutationResult>("rename_item");
export const deletePath = callable<[string, string, string], MutationResult>("delete_item");
export const createFolder = callable<[string, string, string], MutationResult>("create_folder");
export const getOperationProgress = callable<[string], OperationStatus>("get_operation_progress");
export const cancelOperation = callable<[string], { ok: boolean }>("cancel_operation");
export const pauseOperation = callable<[string], { ok: boolean }>("pause_operation");
export const resumeOperation = callable<[string], { ok: boolean }>("resume_operation");
export const readFileContent = callable<[string], { success: boolean; content?: string; error?: string; size?: number; path?: string }>("read_file_content");
export const writeFileContent = callable<[string, string], { success: boolean; path?: string; error?: string }>("write_file_content");
export const setFileSelection = callable<[string, string | null], { success: boolean; selected_file?: string; error?: string }>("set_file_selection");
export const validateExecutable = callable<[string], { success: boolean; path?: string; name?: string; error?: string }>("validate_executable");
export const getProperties = callable<[string], PropertiesData>("get_properties");
export const getDirectorySize = callable<[string], { size: number | null; path: string }>("get_directory_size");
export type DriveResult = {
  ok: boolean;
  path?: string;
  label?: string;
  error?: string;
  needs_password?: boolean;
  wrong_password?: boolean;
  needs_passphrase?: boolean;
  wrong_passphrase?: boolean;
};

export const mountDrive = callable<[string, string | null, string | null], DriveResult>("mount_drive");
export const unmountDrive = callable<[string, string | null], DriveResult>("unmount_drive");
export const renameDrive = callable<[string, string, string | null], DriveResult>("rename_drive");
export const getGameInstallDir = callable<[number, string | null], { success: boolean; path?: string; error?: string }>("get_game_install_dir");
export const getScreenshotsDir = callable<[number], { success: boolean; path?: string; error?: string }>("get_screenshots_dir");

export const isGamescopeSession = callable<[], { gamescope: boolean }>("is_gamescope_session");

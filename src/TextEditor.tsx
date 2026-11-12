import { KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DialogButton, Focusable, NavEntryPositionPreferences, Router, TextField } from "@decky/ui";
import { toaster } from "@decky/api";
import { readFileContent, writeFileContent } from "./api";
import { t, tf } from "./i18n";
import { setSelectionIntent } from "./utils/launchIntent";
import { subscribeEditorFile, takePendingEditorFile } from "./utils/editorHandoff";
import { showErrorToast } from "./utils/operationToast";
import { messageOf } from "./utils/paths";

const MAX_LINES = 3000;
const LINE_STYLE = { width: "100%", background: "#ffffff", border: "none", color: "#000000", fontSize: 18, lineHeight: 1.5, padding: "8px 10px", boxSizing: "border-box", borderRadius: 4 } as const;

const splitLines = (content: string): string[] => {
  const lines = content.split("\n");
  return lines.length > 0 ? lines : [""];
};

export default function TextEditor() {
  const [lines, setLines] = useState<string[]>([""]);
  const [filePath, setFilePath] = useState("");
  const [pathInput, setPathInput] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const lineRefs = useRef<Array<HTMLDivElement | null>>([]);

  const hasUnsavedChanges = useMemo(() => lines.join("\n") !== savedContent, [lines, savedContent]);
  const canSave = Boolean(filePath) && !isLoading && hasUnsavedChanges;

  const lineInput = (index: number) => lineRefs.current[index]?.querySelector<HTMLInputElement>("input") ?? null;

  const focusLine = useCallback((index: number, position?: number) => {
    window.setTimeout(() => {
      const input = lineInput(index);
      if (!input) return;
      input.focus();
      const cursor = position ?? input.value.length;
      try {
        input.setSelectionRange(cursor, cursor);
      } catch {
        // alguns tipos de input não suportam seleção
      }
    }, 0);
  }, []);

  const applyFile = useCallback((path: string, content: string) => {
    const nextLines = splitLines(content);
    if (nextLines.length > MAX_LINES) {
      showErrorToast(tf("editor.error.too_large", { lines: nextLines.length }));
      return;
    }
    setFilePath(path);
    setPathInput(path);
    setSavedContent(content);
    setLines(nextLines);
  }, []);

  const loadFile = useCallback(async (path: string) => {
    setIsLoading(true);
    try {
      const result = await readFileContent(path);
      if (result.success && result.content !== undefined) {
        applyFile(result.path ?? path, result.content);
      } else {
        showErrorToast(tf("editor.error.load_file", { error: result.error || t("state.not_available") }));
      }
    } catch (error) {
      showErrorToast(tf("editor.error.read_file", { error: messageOf(error) }));
    } finally {
      setIsLoading(false);
    }
  }, [applyFile]);

  useEffect(() => {
    const pending = takePendingEditorFile();
    if (pending) {
      applyFile(pending.path, pending.content);
    } else {
      const requested = new URLSearchParams(window.location.search).get("path");
      if (requested) void loadFile(requested);
    }

    return subscribeEditorFile((file) => {
      takePendingEditorFile();
      applyFile(file.path, file.content);
    });
  }, [applyFile, loadFile]);

  useEffect(() => {
    focusLine(0);
  }, [focusLine]);

  const handleOpen = useCallback(() => {
    setSelectionIntent("text-editor");
    Router.CloseSideMenus();
    Router.Navigate?.(`/steam-os-file-manager?textEditorMode=true&path=${encodeURIComponent("~")}`);
  }, []);

  const handleLoadFromPathField = useCallback(() => {
    const trimmed = pathInput.trim();
    if (!trimmed) {
      showErrorToast(t("editor.error.path_required"));
      return;
    }
    void loadFile(trimmed);
  }, [loadFile, pathInput]);

  const handleSave = useCallback(async () => {
    if (!filePath) {
      showErrorToast(t("editor.error.no_file_selected"));
      return;
    }

    setIsLoading(true);
    try {
      const content = lines.join("\n");
      const result = await writeFileContent(filePath, content);
      if (result.success) {
        setSavedContent(content);
        toaster.toast({ title: t("editor.save"), body: t("editor.save_success"), duration: 3000, showToast: true });
      } else {
        showErrorToast(tf("editor.error.save_file", { error: result.error || t("state.not_available") }));
      }
    } catch (error) {
      showErrorToast(tf("editor.error.save_file", { error: messageOf(error) }));
    } finally {
      setIsLoading(false);
    }
  }, [filePath, lines]);

  const updateLine = (index: number, value: string) => {
    setLines((prev) => prev.map((line, i) => (i === index ? value : line)));
  };

  const handleLineKey = (index: number, e: KeyboardEvent<HTMLInputElement>) => {
    const value = e.currentTarget.value;
    const cursor = e.currentTarget.selectionStart ?? value.length;

    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const target = e.key === "ArrowUp" ? index - 1 : index + 1;
      if (target >= 0 && target < lines.length) focusLine(target);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (lines.length >= MAX_LINES) return;
      setLines((prev) => [...prev.slice(0, index), value.slice(0, cursor), value.slice(cursor), ...prev.slice(index + 1)]);
      focusLine(index + 1, 0);
    } else if (e.key === "Backspace" && cursor === 0 && index > 0) {
      e.preventDefault();
      const previous = lines[index - 1] ?? "";
      setLines((prev) => [...prev.slice(0, index - 1), previous + value, ...prev.slice(index + 1)]);
      focusLine(index - 1, previous.length);
    }
  };

  return (
    <div style={{ minHeight: "100vh", height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", position: "relative", background: "#020d18" }}>
      <Focusable style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }} navEntryPreferPosition={NavEntryPositionPreferences.FIRST}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, padding: "56px 12px 60px", boxSizing: "border-box" }}>
          <div style={{ width: "100%", marginBottom: 8 }}>
            <TextField
              value={pathInput}
              onChange={(e) => setPathInput(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleLoadFromPathField();
                }
              }}
              bShowCopyAction={false}
              style={{ width: "100%", boxSizing: "border-box", minWidth: 0, backgroundColor: "#f0f0f0", color: "#000000" }}
            />
          </div>

          <div style={{ width: "100%", padding: "8px 0", boxSizing: "border-box", minWidth: 0, marginBottom: 12 }}>
            <Focusable navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X} style={{ display: "flex", gap: 12, width: "100%" }}>
              <DialogButton onClick={handleOpen} style={{ flex: 1 }} disabled={isLoading} focusable={!isLoading}>
                {t("editor.open")}
              </DialogButton>
              <DialogButton onClick={handleSave} style={{ flex: 1, opacity: canSave ? 1 : 0.5 }} disabled={!canSave} focusable={canSave}>
                {t("editor.save")}
              </DialogButton>
            </Focusable>
          </div>

          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
              background: "#ffffff",
              overflow: "auto",
              padding: 8,
              opacity: isLoading ? 0.6 : 1,
              pointerEvents: isLoading ? "none" : "auto",
            }}
          >
            <Focusable style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
              {lines.map((line, index) => (
                <div key={index} ref={(node) => { lineRefs.current[index] = node; }} style={{ width: "100%" }}>
                  <TextField
                    value={line}
                    onChange={(e) => updateLine(index, e.currentTarget.value)}
                    onKeyDown={(e) => handleLineKey(index, e)}
                    style={LINE_STYLE}
                  />
                </div>
              ))}
            </Focusable>
          </div>
        </div>
      </Focusable>
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from "react";
import { Focusable, TextField, DialogButton, NavEntryPositionPreferences, Router } from "@decky/ui";
import { callable } from "@decky/api";
import { t } from "./i18n";

const initialLines = [""];

export default function TextEditor() {
  const [lines, setLines] = useState<string[]>(initialLines);
  const [filePath, setFilePath] = useState<string>("");
  const [isLoading, setIsLoading] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const itemRefs = useRef<Array<HTMLDivElement | null>>([]);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  const lastSavedContentRef = useRef<string>("");

  const readFileContent = callable<[string], { success: boolean; content?: string; error?: string; size?: number }>("read_file_content");
  const writeFileContent = callable<[string, string], { success: boolean; path?: string; error?: string }>("write_file_content");

  const focusLine = (index: number) => {
    const wrapper = itemRefs.current[index];
    const node = wrapper?.querySelector<HTMLInputElement>("input");
    if (node) {
      node.focus();
      const valueLength = node.value.length;
      try {
        node.setSelectionRange(valueLength, valueLength);
      } catch {}
    }
  };

  const updateLineValue = (index: number, value: string) => {
    setLines((prev) => {
      const next = [...prev];
      next[index] = value;
      const nextContent = next.join("\n");
      setHasUnsavedChanges(nextContent !== lastSavedContentRef.current);
      return next;
    });
  };

  const handleOpen = useCallback(() => {
    sessionStorage.setItem("_decky_text_editor_selection_mode", "true");
    Router.CloseSideMenus();
    Router.Navigate?.(`/steam-os-file-manager?textEditorMode=true&path=${encodeURIComponent("~")}`);
  }, []);

  const loadFile = useCallback(async (filePath: string) => {
    setIsLoading(true);
    try {
      const result = await readFileContent(filePath);
      if (result.success && result.content !== undefined) {
        setFilePath(filePath);
        const fileLines = result.content.split("\n");
        lastSavedContentRef.current = result.content;
        setHasUnsavedChanges(false);
        setLines(fileLines.length > 0 ? fileLines : [""]);
      } else if (!result.success) {
        alert(t("editor.error.load_file").replace("{error}", result.error || t("state.not_available")));
      }
    } catch (error) {
      alert(t("editor.error.read_file").replace("{error}", String(error)));
    } finally {
      setIsLoading(false);
    }
  }, [readFileContent]);

  const handleLoadFromPathField = useCallback(async () => {
    const trimmed = filePath.trim();
    if (!trimmed) {
      alert(t("editor.error.path_required"));
      return;
    }
    await loadFile(trimmed);
  }, [filePath, loadFile]);

  const canSave = Boolean(filePath) && !isLoading && hasUnsavedChanges;

  const handleSave = useCallback(async () => {
    if (!filePath) {
      alert(t("editor.error.no_file_selected"));
      return;
    }

    setIsLoading(true);
    try {
      const nextContent = lines.join("\n");
      const result = await writeFileContent(filePath, nextContent);
      if (result.success) {
        lastSavedContentRef.current = nextContent;
        setHasUnsavedChanges(false);
        alert(t("editor.save_success"));
      } else {
        alert(t("editor.error.save_file").replace("{error}", result.error || t("state.not_available")));
      }
    } catch (error) {
      alert(t("editor.error.save_file").replace("{error}", String(error)));
    } finally {
      setIsLoading(false);
    }
  }, [filePath, lines, writeFileContent]);

  useEffect(() => {
    const first = itemRefs.current[0]?.querySelector<HTMLInputElement>("input");
    if (first) {
      first.focus();
    }
  }, []);

  useEffect(() => {
    const applySelectedFile = async (selectedFile: string, contentOverride?: string) => {
      const normalized = decodeURIComponent(selectedFile);
      if (contentOverride !== undefined) {
        setFilePath(normalized);
        const fileLines = contentOverride.split("\n");
        setLines(fileLines.length > 0 ? fileLines : [""]);
        setIsLoading(false);
        return;
      }
      await loadFile(normalized);
    };

    const loadPathFromLocation = async () => {
      const params = new URLSearchParams(window.location.search);
      const selectedFile = params.get("path") || localStorage.getItem("_text_editor_selected_file_path") || (window as any).__decky_manager_text_editor_path;
      const contentOverride = (window as any).__decky_manager_text_editor_content;

      if (selectedFile) {
        await applySelectedFile(selectedFile, contentOverride);
        localStorage.removeItem("_text_editor_selected_file_path");
        delete (window as any).__decky_manager_text_editor_path;
        delete (window as any).__decky_manager_text_editor_content;
        if (window.location.search.includes("path=")) {
          const nextUrl = new URL(window.location.href);
          nextUrl.searchParams.delete("path");
          window.history.replaceState({}, "", nextUrl.toString());
        }
      }
    };

    const handleSelectedFile = (event: Event) => {
      const customEvent = event as CustomEvent<{ path?: string; content?: string }>;
      const selectedFile = customEvent.detail?.path;
      const content = customEvent.detail?.content;

      if (selectedFile) {
        void applySelectedFile(selectedFile, content);
      }
    };

    void loadPathFromLocation();

    const handleVisibilityChange = () => {
      if (!document.hidden) {
        void loadPathFromLocation();
      }
    };

    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === "_text_editor_selected_file_path" && e.newValue) {
        void loadFile(e.newValue);
        localStorage.removeItem("_text_editor_selected_file_path");
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("storage", handleStorageChange);
    window.addEventListener("decky-manager-text-editor-file-selected", handleSelectedFile);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("storage", handleStorageChange);
      window.removeEventListener("decky-manager-text-editor-file-selected", handleSelectedFile);
    };
  }, [loadFile]);

  const moveLine = (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex >= 0 && targetIndex < lines.length) {
      focusLine(targetIndex);
    }
  };

  return (
    <div
      ref={editorContainerRef}
      style={{
        minHeight: "100vh",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        position: "relative",
        background: "#020d18",
      }}
    >
      <Focusable
        style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}
        navEntryPreferPosition={NavEntryPositionPreferences.FIRST}
      >
        <div style={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0, padding: "56px 12px 60px", boxSizing: "border-box" }}>
          {/* Campo de caminho - somente leitura */}
          <div style={{ width: "100%", marginBottom: "8px" }}>
            <TextField
              value={filePath}
              onChange={(e) => setFilePath(e.currentTarget.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void handleLoadFromPathField();
                }
              }}
              bShowCopyAction={false}
              style={{
                width: "100%",
                boxSizing: "border-box",
                minWidth: 0,
                opacity: 1,
                backgroundColor: "#f0f0f0",
                color: "#000000",
              }}
            />
          </div>

          {/* Barra de ações com botões */}
          <div style={{ width: "100%", padding: "8px 0", boxSizing: "border-box", minWidth: 0, marginBottom: "12px" }}>
            <Focusable
              navEntryPreferPosition={NavEntryPositionPreferences.MAINTAIN_X}
              style={{ display: "flex", gap: "12px", width: "100%", padding: "0" }}
            >
              <DialogButton onClick={handleOpen} style={{ flex: 1 }} disabled={isLoading} focusable={!isLoading}>
                {t("editor.open")}
              </DialogButton>
              <DialogButton
                onClick={handleSave}
                style={{ flex: 1, opacity: canSave ? 1 : 0.5 }}
                disabled={!canSave}
                focusable={canSave}
              >
                {t("editor.save")}
              </DialogButton>
            </Focusable>
          </div>

          {/* Área de edição */}
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              minHeight: 0,
              background: "#ffffff",
              borderRadius: 0,
              overflow: "auto",
              padding: 8,
              opacity: isLoading ? 0.6 : 1,
              pointerEvents: isLoading ? "none" : "auto",
            }}
          >
            <Focusable style={{ width: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
              {lines.map((line, index) => (
                <div
                  key={`line-${index}`}
                  ref={(node) => {
                    itemRefs.current[index] = node;
                    if (!node) return;
                    const input = node.querySelector<HTMLInputElement>("input");
                    if (input) {
                      inputRefs.current[index] = input;
                    }
                  }}
                  style={{ width: "100%" }}
                >
                  <TextField
                    value={line}
                    onChange={(e) => updateLineValue(index, e.currentTarget.value)}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowUp") {
                        e.preventDefault();
                        moveLine(index, "up");
                      } else if (e.key === "ArrowDown") {
                        e.preventDefault();
                        moveLine(index, "down");
                      } else if (e.key === "Enter") {
                        e.preventDefault();
                        const currentValue = e.currentTarget.value;
                        const cursorPos = e.currentTarget.selectionStart ?? currentValue.length;
                        const left = currentValue.slice(0, cursorPos);
                        const right = currentValue.slice(cursorPos);

                        setLines((prev) => {
                          const next = [...prev];
                          next[index] = left;
                          next.splice(index + 1, 0, right);
                          return next;
                        });

                        window.setTimeout(() => {
                          const target = inputRefs.current[index + 1];
                          if (target) {
                            target.focus();
                            target.setSelectionRange(0, 0);
                          }
                        }, 0);
                      } else if (e.key === "Backspace") {
                        const currentValue = e.currentTarget.value;
                        const cursorPos = e.currentTarget.selectionStart ?? currentValue.length;

                        if (currentValue.length === 0 || cursorPos === 0) {
                          if (index > 0) {
                            e.preventDefault();
                            const previousLine = lines[index - 1] ?? "";
                            setLines((prev) => {
                              const next = [...prev];
                              const merged = previousLine + (currentValue || "");
                              next[index - 1] = merged;
                              next.splice(index, 1);
                              return next;
                            });

                            window.setTimeout(() => {
                              const target = inputRefs.current[index - 1];
                              if (target) {
                                const finalPos = previousLine.length + (currentValue || "").length;
                                target.focus();
                                try {
                                  target.setSelectionRange(finalPos, finalPos);
                                } catch {}
                              }
                            }, 0);
                          }
                        }
                      }
                    }}
                    style={{
                      width: "100%",
                      background: "#ffffff",
                      border: "none",
                      color: "#000000",
                      fontSize: 18,
                      lineHeight: 1.5,
                      padding: "8px 10px",
                      boxSizing: "border-box",
                      borderRadius: 4,
                    }}
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

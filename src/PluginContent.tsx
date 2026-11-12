import { Fragment, useCallback } from "react";
import { PanelSection, PanelSectionRow, ButtonItem, Router } from "@decky/ui";
import { t } from "./i18n";
import { PlusSquareFillIcon, PluginIcon } from "./Icons";
import { setSelectionIntent } from "./utils/launchIntent";
import { cancelOperation, pauseOperation, resumeOperation } from "./api";
import BackgroundOperationRow from "./components/BackgroundOperationRow";
import { useBackgroundOperations } from "./hooks/useBackgroundOperations";
import {
  BackgroundOperationState,
  dispatchFileManagerRefresh,
  markOperationCanceled,
  patchBackgroundOperation,
  removeBackgroundOperation,
  unmarkOperationCanceled,
} from "./utils/backgroundStore";

const DEFAULT_MANAGER_PATH = "~";
const ROW_STYLE = { width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 } as const;
const LABEL_STYLE = { marginLeft: "auto", textAlign: "right", width: "100%" } as const;
const HEADING_STYLE = { width: "100%", fontWeight: 700, opacity: 0.9, color: "#fff", textAlign: "center" } as const;

function Content() {
  const operations = useBackgroundOperations();

  const openFullScreen = useCallback(() => {
    setSelectionIntent(null);
    Router.CloseSideMenus();
    Router.Navigate?.(`/steam-os-file-manager?path=${encodeURIComponent(DEFAULT_MANAGER_PATH)}&mode=normal`);
  }, []);

  const openGamePicker = useCallback(() => {
    setSelectionIntent("shortcut");
    Router.CloseSideMenus();
    Router.Navigate?.(`/steam-os-file-manager/select-file?path=${encodeURIComponent(DEFAULT_MANAGER_PATH)}`);
  }, []);

  const handlePauseToggle = useCallback(async (operation: BackgroundOperationState) => {
    try {
      await (operation.paused ? resumeOperation : pauseOperation)(operation.operationId);
      patchBackgroundOperation(operation.operationId, { paused: !operation.paused });
    } catch (e) {
      console.warn("background pause toggle failed", e);
    }
  }, []);

  const handleCancel = useCallback(async (operation: BackgroundOperationState) => {
    markOperationCanceled(operation.operationId);
    try {
      await cancelOperation(operation.operationId);
      removeBackgroundOperation(operation.operationId);
      dispatchFileManagerRefresh();
    } catch (e) {
      unmarkOperationCanceled(operation.operationId);
      console.warn("background cancel failed", e);
    }
  }, []);

  return (
    <PanelSection>
      <PanelSectionRow>
        <ButtonItem onClick={openFullScreen} layout="below">
          <div style={ROW_STYLE}>
            <PluginIcon />
            <span style={LABEL_STYLE}>{t("action.open_file_manager")}</span>
          </div>
        </ButtonItem>
      </PanelSectionRow>
      <PanelSectionRow>
        <ButtonItem onClick={openGamePicker} layout="below">
          <div style={ROW_STYLE}>
            <PlusSquareFillIcon />
            <span style={LABEL_STYLE}>{t("action.add_shortcut")}</span>
          </div>
        </ButtonItem>
      </PanelSectionRow>
      {operations.length > 0 ? (
        <>
          <PanelSectionRow>
            <div style={{ ...HEADING_STYLE, marginTop: 3 }}>{t("panel.background.title")}</div>
          </PanelSectionRow>
          {operations.map((operation, index) => (
            <Fragment key={operation.operationId}>
              <PanelSectionRow>
                <BackgroundOperationRow operation={operation} onPauseToggle={handlePauseToggle} onCancel={handleCancel} />
              </PanelSectionRow>
              {index < operations.length - 1 ? (
                <PanelSectionRow>
                  <div style={{ width: "100%", height: 1, background: "rgba(255,255,255,0.08)", margin: "4px 0" }} />
                </PanelSectionRow>
              ) : null}
            </Fragment>
          ))}
        </>
      ) : (
        <PanelSectionRow>
          <div style={{ ...HEADING_STYLE, paddingTop: 3 }}>{t("panel.background.none")}</div>
        </PanelSectionRow>
      )}
    </PanelSection>
  );
}

export default Content;

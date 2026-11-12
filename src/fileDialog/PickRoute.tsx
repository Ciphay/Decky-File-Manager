import { useEffect, useRef, useSyncExternalStore } from "react";
import { Navigation } from "@decky/ui";
import FileManagerPage from "../FileManagerPage";
import { getActivePickSession, subscribeActivePickSession } from "./pickerSession";

export default function PickRoute() {
  const session = useSyncExternalStore(subscribeActivePickSession, getActivePickSession);
  const openedWithoutSession = useRef(session === null);
  const lastSession = useRef(session);
  if (session) lastSession.current = session;

  useEffect(() => {
    if (openedWithoutSession.current) Navigation.NavigateBack?.();
  }, []);

  useEffect(() => () => lastSession.current?.abandon(), []);

  const shown = session ?? lastSession.current;
  return shown ? <FileManagerPage pick={shown} /> : null;
}

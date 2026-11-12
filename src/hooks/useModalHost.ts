import { ReactNode, useEffect, useRef } from "react";
import { showModal } from "@decky/ui";

type ModalHandle = { Close: () => void; Update?: (modal: ReactNode) => void };

export function useModalHost(content: ReactNode | null) {
  const handleRef = useRef<ModalHandle | null>(null);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const existing = handleRef.current;
      if (!content) {
        existing?.Close();
        handleRef.current = null;
        return;
      }
      if (existing?.Update) {
        existing.Update(content);
        return;
      }
      existing?.Close();
      handleRef.current = showModal(content as any) as ModalHandle;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [content]);

  useEffect(() => () => {
    handleRef.current?.Close();
    handleRef.current = null;
  }, []);
}

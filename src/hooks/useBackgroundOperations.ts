import { useSyncExternalStore } from "react";
import { BackgroundOperationState, getBackgroundOperations, subscribeBackgroundOperations } from "../utils/backgroundStore";

export function useBackgroundOperations(): BackgroundOperationState[] {
  return useSyncExternalStore(subscribeBackgroundOperations, getBackgroundOperations);
}

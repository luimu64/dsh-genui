import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useRendererQuery } from "@openuidev/react-lang";

/**
 * Image components paint their own progress while ComfyUI renders: the shimmer on
 * `.genimg-loading`, plus the "rendering…" label. That *is* the feedback
 * for an image query, so the turn must not stack its dots or the renderer's loader on
 * top of it. Placeholders register here, per renderer, and the indicators consult it.
 *
 * A store rather than React state because a placeholder mounting must not re-render
 * the component that renders it — it only has to invalidate the indicators.
 */
export type ImageWaitStore = {
  subscribe: (listener: () => void) => () => void;
  count: () => number;
  start: () => void;
  stop: () => void;
};

function createImageWaitStore(): ImageWaitStore {
  let count = 0;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of listeners) listener();
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    count: () => count,
    start: () => {
      count += 1;
      emit();
    },
    stop: () => {
      count = Math.max(0, count - 1);
      emit();
    },
  };
}

const ImageWaitContext = createContext<ImageWaitStore | null>(null);

const noSubscribe = () => () => {};
const zero = () => 0;

/** Scopes placeholder registration to one rendered answer. */
export function ImageWaitProvider({ children }: { children: ReactNode }) {
  const store = useMemo(createImageWaitStore, []);
  return <ImageWaitContext.Provider value={store}>{children}</ImageWaitContext.Provider>;
}

/** True while this answer already shows an image placeholder that is animating. */
export function useImageAnimating(): boolean {
  const store = useContext(ImageWaitContext);
  return (
    useSyncExternalStore(
      store ? store.subscribe : noSubscribe,
      store ? store.count : zero,
      store ? store.count : zero,
    ) > 0
  );
}

/**
 * The frame an image component paints until its render arrives. It registers itself as
 * the turn's progress while it shimmers, and unregisters when the picture replaces it.
 *
 * A failed query is not still rendering: the frame stops shimmering and says so, so a
 * failed answer cannot leave an animation running forever.
 */
export function ImagePlaceholder({
  height,
  children,
}: {
  height: number;
  children?: ReactNode;
}) {
  const store = useContext(ImageWaitContext);
  const { errors } = useRendererQuery();
  const failed = errors.length > 0;

  useEffect(() => {
    if (!store || failed) return;
    store.start();
    return store.stop;
  }, [store, failed]);

  if (failed) {
    return (
      <div className="genimg-loading is-failed" style={{ height }} role="status">
        could not render this picture
      </div>
    );
  }

  return (
    <div className="genimg-loading" style={{ height }} role="status">
      {children}
    </div>
  );
}

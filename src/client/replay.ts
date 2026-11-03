/**
 * Whether the turn being painted is allowed to create new pictures.
 *
 * Every stored answer replays its `Query("generate_image", …)` when it is rendered. That
 * was harmless while the only cost was a cache miss, but it is the whole reason opening a
 * conversation re-ran old batches: a miss went straight to ComfyUI. Generation is now a
 * permission the turn holds, not an assumption a component makes:
 *
 *  - the turn the user is actually producing (`live`) may render;
 *  - a stored turn may only *display* what is already on disk. A frame that is genuinely
 *    gone is painted as unavailable, and `retry()` is the explicit request that turns that
 *    turn's generation back on — for that turn only.
 *
 * The scope is a React context rather than a module-level "current turn" slot, because
 * every turn mounts its renderer at once: a process-wide claim was decided by whichever
 * turn happened to parse last, which is also how one turn's quality could reach another's
 * query.
 */
import { createContext, useContext } from "react";

export type ReplayAccess = {
  /** True only for the turn that may queue work right now. */
  allowGeneration: boolean;
  /** The user asked for this turn's missing pictures to be made again. */
  retry: () => void;
};

const inert: ReplayAccess = { allowGeneration: false, retry: () => {} };

export const ReplayContext = createContext<ReplayAccess>(inert);

export function useReplay(): ReplayAccess {
  return useContext(ReplayContext);
}

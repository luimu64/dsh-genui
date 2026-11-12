/**
 * Whether the turn being painted is allowed to create new pictures.
 *
 * Every stored answer replays its `Query(...)` calls when it is rendered. That was harmless
 * while the only cost was a cache miss, but it is the whole reason opening a conversation
 * re-ran old work: a miss went straight to whatever served the tool. Doing that work is now a
 * permission the turn holds, not an assumption a component makes:
 *
 *  - the turn the user is actually producing (`live`) may do the work;
 *  - a stored turn may only *display* what is already on disk. A frame that is genuinely
 *    gone is painted as unavailable, and `retry()` is the explicit request that turns that
 *    turn's tool work back on — for that turn only.
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
  /**
   * What the query provider will actually do: `allowGeneration`, or "this is the newest
   * answer, so it is what the user is looking at". The two differ after a reload, where a
   * stored answer is not `live` but the newest one still dispatches.
   *
   * The image components read this one. They used `allowGeneration`, so a frame that was
   * rendering at that moment was painted as "this picture is not saved on this machine" —
   * a terminal message with a retry button, next to a sibling that said "rendering…".
   */
  mayGenerate: () => boolean;
  /** The user asked for this turn's missing pictures to be made again. */
  retry: () => void;
};

const inert: ReplayAccess = {
  allowGeneration: false,
  mayGenerate: () => false,
  retry: () => {},
};

export const ReplayContext = createContext<ReplayAccess>(inert);

export function useReplay(): ReplayAccess {
  return useContext(ReplayContext);
}

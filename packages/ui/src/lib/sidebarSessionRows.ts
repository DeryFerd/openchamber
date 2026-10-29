import type { Session } from '@/lib/opencode/model';
import { isBtwSession } from '@/lib/sessionBtwMetadata';
import { isSessionInWork } from '@/lib/sessionWorkMetadata';

/**
 * Whether a top-level session has a row in the sidebar, by the rules that hold
 * in every sidebar layout: a /btw fork never does (`partitionSidebarSessions`),
 * a session the sidebar can place under a project, worktree, chat or space
 * does, and a pinned or in-work session does while the Pinned and In work
 * zones actually render — the zones are optional, so a caller that knows they
 * are hidden passes `pinnedVisible` / `workVisible` as false and an unplaced
 * session in an unconfigured directory then has no row at all (#5861).
 * Surfaces that list sessions outside the sidebar (the desktop tray) use this,
 * so the two agree.
 */
export const sessionHasSidebarRow = (
  session: Session,
  {
    isPlaced,
    isPinned,
    pinnedVisible = true,
    workVisible = true,
  }: { isPlaced: boolean; isPinned: boolean; pinnedVisible?: boolean; workVisible?: boolean },
): boolean => {
  if (session.parentID || session.time?.archived || isBtwSession(session)) return false;
  return isPlaced || (pinnedVisible && isPinned) || (workVisible && isSessionInWork(session));
};

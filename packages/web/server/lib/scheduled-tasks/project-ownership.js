import path from 'node:path';

/**
 * Which registered project owns a directory, in one place.
 *
 * A session can run in a linked Git worktree of a project without that
 * worktree being a project of its own, so comparing root paths is not enough:
 * ownership comes from Git through `resolvePrimaryWorktreeRoot`. Target
 * validation and discovery ask here, and so does the agent-facing
 * `resolveProjectID`, so they cannot disagree.
 */
export const createProjectDirectoryOwnership = ({ listProjects, resolvePrimaryWorktreeRoot }) => {
  const ownsDirectory = async (project, directory) => {
    if (!project || !directory) return false;
    if (path.resolve(directory) === path.resolve(project.path)) return true;
    if (!resolvePrimaryWorktreeRoot) return false;
    const owner = await resolvePrimaryWorktreeRoot(directory);
    return Boolean(owner?.root) && path.resolve(owner.root) === path.resolve(project.path);
  };

  /** The project a directory belongs to, or null when none registered owns it. */
  const projectOwningDirectory = async (directory) => {
    if (!directory) return null;
    const resolved = path.resolve(directory);
    const projects = await listProjects();
    const exact = projects.find((entry) => path.resolve(entry.path) === resolved);
    if (exact) return exact;
    if (!resolvePrimaryWorktreeRoot) return null;
    const owner = await resolvePrimaryWorktreeRoot(resolved);
    if (!owner?.root) return null;
    const root = path.resolve(owner.root);
    return projects.find((entry) => path.resolve(entry.path) === root) || null;
  };

  return { ownsDirectory, projectOwningDirectory };
};

import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// GNOME 46+ shows a window's icon only through a .desktop file whose name or
// StartupWMClass matches the window's app id; a window without one gets the
// generic executable icon, on Wayland and XWayland alike. An AppImage started
// from a file manager has no such file, so the packaged app writes its own
// unless another integration (Gear Lever, AppImageLauncher, appimaged) owns it.
// GNOME re-matches open windows when the file appears, so the first launch
// gets the icon a few seconds after this runs.

const DESKTOP_FILE_NAME = 'openchamber.desktop';
const WM_CLASS = 'openchamber';
const MANAGED_KEY = 'X-OpenChamber-Managed';
const ICON_RELATIVE_PATH = path.join('icons', 'hicolor', '512x512', 'apps', 'openchamber.png');
const APPDIR_ICON_RELATIVE_PATH = path.join('usr', 'share', 'icons', 'hicolor', '512x512', 'apps', 'openchamber.png');
// Desktop Entry spec default for XDG_DATA_DIRS when it is unset or empty.
const DEFAULT_DATA_DIRS = ['/usr/local/share', '/usr/share'];

const resolveDataHome = (env, homeDir) => {
  const value = (env.XDG_DATA_HOME ?? '').trim();
  return value && path.isAbsolute(value) ? value : path.join(homeDir, '.local', 'share');
};

const resolveDataDirs = (env) => {
  const value = (env.XDG_DATA_DIRS ?? '').trim();
  // The XDG spec separates entries with a colon, which is also `path.delimiter`
  // on the only platform this runs on (Linux); using it keeps the module
  // testable on a host whose path separator differs.
  const entries = value ? value.split(path.delimiter) : DEFAULT_DATA_DIRS;
  return entries.map((entry) => entry.trim()).filter((entry) => entry && path.isAbsolute(entry));
};

/** Whether `candidate` is `directory` or lives under it. */
const isInsideDirectory = (candidate, directory) => {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedDirectory = path.resolve(directory);
  return resolvedCandidate === resolvedDirectory || resolvedCandidate.startsWith(`${resolvedDirectory}${path.sep}`);
};

// Desktop Entry spec: a string value escapes backslashes; an Exec argument is
// double-quoted with ", `, $ and \ escaped, and a literal % is written %%.
const escapeDesktopString = (value) => value.replace(/\\/g, '\\\\');
const quoteExecArgument = (value) => `"${value.replace(/(["`$\\])/g, '\\$1')}"`.replace(/%/g, '%%');

export const buildAppImageDesktopEntry = ({ appImagePath, iconPath }) => [
  '[Desktop Entry]',
  'Type=Application',
  'Name=OpenChamber',
  'Comment=Desktop runtime for OpenChamber',
  `Exec=${escapeDesktopString(quoteExecArgument(appImagePath))} %U`,
  `TryExec=${escapeDesktopString(appImagePath)}`,
  `Icon=${escapeDesktopString(iconPath)}`,
  'Terminal=false',
  'StartupNotify=true',
  `StartupWMClass=${WM_CLASS}`,
  'Categories=Development;',
  `${MANAGED_KEY}=true`,
  '',
].join('\n');

const readDesktopKeys = (contents) => {
  const keys = new Map();
  let inMainGroup = false;
  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('[')) {
      inMainGroup = line === '[Desktop Entry]';
      continue;
    }
    const separator = line.indexOf('=');
    if (!inMainGroup || separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    if (!keys.has(key)) keys.set(key, line.slice(separator + 1).trim());
  }
  return keys;
};

const isManagedEntry = (keys) => keys.get(MANAGED_KEY) === 'true';

const readFileOrNull = async (filePath) => {
  try {
    return await fsp.readFile(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null;
    throw error;
  }
};

// Another launcher entry for this app: one that claims our window class, or one
// that starts this very AppImage. Gear Lever, AppImageLauncher and appimaged
// write theirs into the user's applications folder; a system package (.deb,
// RPM, Nix) installs its own under an XDG_DATA_DIRS entry, and that one wins
// the user entry in the XDG lookup, so it has to be seen too. The AppImage's
// own bundled entry lives inside its mount, which the launcher also puts on
// XDG_DATA_DIRS; that is not another integration.
const findForeignEntry = async ({ directories, ownPath, appImagePath, appDir }) => {
  for (const directory of directories) {
    let names;
    try {
      names = await fsp.readdir(directory);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith('.desktop')) continue;
      const filePath = path.join(directory, name);
      if (filePath === ownPath) continue;
      if (appDir && isInsideDirectory(filePath, appDir)) continue;
      const contents = await readFileOrNull(filePath).catch(() => null);
      if (!contents) continue;
      const keys = readDesktopKeys(contents.toString('utf8'));
      if (isManagedEntry(keys)) continue;
      // Only a known AppImage path makes the "starts this AppImage" test
      // meaningful; an empty path would match every Exec line.
      const launchesAppImage = Boolean(appImagePath)
        && [keys.get('Exec'), keys.get('TryExec')].some((value) => value?.includes(appImagePath));
      if (keys.get('StartupWMClass') === WM_CLASS || launchesAppImage) return filePath;
    }
  }
  return null;
};

const writeIfChanged = async (filePath, contents) => {
  const current = await readFileOrNull(filePath);
  if (current && current.equals(contents)) return false;
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.tmp`;
  try {
    await fsp.writeFile(tempPath, contents, { mode: 0o644 });
    await fsp.rename(tempPath, filePath);
  } catch (error) {
    await fsp.rm(tempPath, { force: true });
    throw error;
  }
  return true;
};

const removeManagedEntry = async ({ desktopPath, iconPath }) => {
  const contents = await readFileOrNull(desktopPath);
  if (!contents || !isManagedEntry(readDesktopKeys(contents.toString('utf8')))) return false;
  await fsp.rm(desktopPath, { force: true });
  await fsp.rm(iconPath, { force: true });
  return true;
};

/**
 * Keeps the user's launcher entry for a running AppImage in step with it:
 * written when nothing else integrates the app, rewritten when the AppImage
 * moved (in-app updates may rename it), and withdrawn once another
 * integration appears. Files without our marker are never touched.
 *
 * "Another integration" includes a system package's own entry under
 * `XDG_DATA_DIRS` (.deb, RPM, Nix): that entry wins the XDG lookup over the
 * user one, so a managed entry left behind keeps launching the old,
 * self-updating AppImage. A packaged run never sets `APPIMAGE`/`APPDIR`, so it
 * takes the `not-appimage` path, which still withdraws a stale managed entry
 * once the system entry is present.
 */
export const reconcileAppImageDesktopEntry = async ({
  env = process.env,
  homeDir = os.homedir(),
} = {}) => {
  const appImagePath = (env.APPIMAGE ?? '').trim();
  const appDir = (env.APPDIR ?? '').trim();
  const isAppImage = path.isAbsolute(appImagePath) && path.isAbsolute(appDir) && !/[\r\n]/.test(appImagePath);

  const dataHome = resolveDataHome(env, homeDir);
  const desktopPath = path.join(dataHome, 'applications', DESKTOP_FILE_NAME);
  const iconPath = path.join(dataHome, ICON_RELATIVE_PATH);
  const applicationDirs = [
    path.dirname(desktopPath),
    ...resolveDataDirs(env).map((dir) => path.join(dir, 'applications')),
  ];

  // Gear Lever and the old AppImageKit integration launch with this set.
  if ((env.DESKTOPINTEGRATION ?? '').trim()) {
    return { status: 'external', removed: await removeManagedEntry({ desktopPath, iconPath }) };
  }

  // A packaged (non-AppImage) run integrates nothing of its own, but a previous
  // AppImage's managed entry can still be on disk. Withdraw it once a
  // system-level entry proves the app is integrated elsewhere.
  if (!isAppImage) {
    const foreignEntry = await findForeignEntry({ directories: applicationDirs, ownPath: desktopPath, appImagePath: '', appDir: '' });
    if (foreignEntry) {
      return { status: 'external', removed: await removeManagedEntry({ desktopPath, iconPath }) };
    }
    return { status: 'not-appimage' };
  }

  const ownEntry = await readFileOrNull(desktopPath);
  const ownKeys = ownEntry ? readDesktopKeys(ownEntry.toString('utf8')) : null;
  if (ownKeys && !isManagedEntry(ownKeys)) {
    return { status: 'external', removed: false };
  }
  // Menu editors hide an entry by writing one of these keys into it.
  if (ownKeys && (ownKeys.get('NoDisplay') === 'true' || ownKeys.get('Hidden') === 'true')) {
    return { status: 'hidden-by-user' };
  }

  const foreignEntry = await findForeignEntry({ directories: applicationDirs, ownPath: desktopPath, appImagePath, appDir });
  if (foreignEntry) {
    return { status: 'external', removed: await removeManagedEntry({ desktopPath, iconPath }) };
  }

  const icon = await readFileOrNull(path.join(appDir, APPDIR_ICON_RELATIVE_PATH));
  if (!icon) return { status: 'no-icon' };

  // Icon first: GNOME reads the entry as soon as it appears.
  const iconChanged = await writeIfChanged(iconPath, icon);
  const entryChanged = await writeIfChanged(desktopPath, Buffer.from(buildAppImageDesktopEntry({ appImagePath, iconPath }), 'utf8'));
  return { status: 'integrated', changed: iconChanged || entryChanged, desktopPath };
};

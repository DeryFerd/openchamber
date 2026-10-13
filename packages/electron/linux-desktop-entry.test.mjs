import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { buildAppImageDesktopEntry, reconcileAppImageDesktopEntry } from './linux-desktop-entry.mjs';

const ICON = Buffer.from('png-bytes');

const makeLab = async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-desktop-entry-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const appDir = path.join(root, 'mount');
  const iconSource = path.join(appDir, 'usr/share/icons/hicolor/512x512/apps/openchamber.png');
  await fs.mkdir(path.dirname(iconSource), { recursive: true });
  await fs.writeFile(iconSource, ICON);
  const dataHome = path.join(root, 'data');
  // A hermetic system data root: XDG_DATA_DIRS is scanned for a system-package
  // entry, so tests must not point it at the host's /usr/share.
  const systemDataDir = path.join(root, 'system-data');
  const env = {
    APPIMAGE: path.join(root, 'Downloads', 'OpenChamber-2.3.0-linux-x86_64.AppImage'),
    APPDIR: appDir,
    XDG_DATA_HOME: dataHome,
    XDG_DATA_DIRS: systemDataDir,
  };
  return {
    env,
    homeDir: root,
    systemDataDir,
    desktopPath: path.join(dataHome, 'applications', 'openchamber.desktop'),
    iconPath: path.join(dataHome, 'icons/hicolor/512x512/apps/openchamber.png'),
  };
};

const writeEntry = async (filePath, contents) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, contents);
};

test('a first AppImage launch writes a visible launcher entry and its icon', async (t) => {
  const lab = await makeLab(t);
  const result = await reconcileAppImageDesktopEntry({ env: lab.env, homeDir: lab.homeDir });

  assert.deepEqual(result, { status: 'integrated', changed: true, desktopPath: lab.desktopPath });
  assert.deepEqual(await fs.readFile(lab.iconPath), ICON);
  const entry = await fs.readFile(lab.desktopPath, 'utf8');
  assert.match(entry, /^StartupWMClass=openchamber$/m);
  assert.match(entry, new RegExp(`^TryExec=${lab.env.APPIMAGE}$`, 'm'));
  assert.match(entry, new RegExp(`^Icon=${lab.iconPath}$`, 'm'));
  assert.doesNotMatch(entry, /NoDisplay/);
});

test('a second launch from the same place changes nothing', async (t) => {
  const lab = await makeLab(t);
  await reconcileAppImageDesktopEntry({ env: lab.env, homeDir: lab.homeDir });
  const result = await reconcileAppImageDesktopEntry({ env: lab.env, homeDir: lab.homeDir });
  assert.equal(result.changed, false);
});

test('an entry the user hid with a menu editor stays hidden', async (t) => {
  const lab = await makeLab(t);
  await reconcileAppImageDesktopEntry({ env: lab.env, homeDir: lab.homeDir });
  const hidden = `${await fs.readFile(lab.desktopPath, 'utf8')}NoDisplay=true\n`;
  await fs.writeFile(lab.desktopPath, hidden);

  const result = await reconcileAppImageDesktopEntry({ env: lab.env, homeDir: lab.homeDir });
  assert.deepEqual(result, { status: 'hidden-by-user' });
  assert.equal(await fs.readFile(lab.desktopPath, 'utf8'), hidden);
});

test('a moved AppImage rewrites Exec and TryExec', async (t) => {
  const lab = await makeLab(t);
  await reconcileAppImageDesktopEntry({ env: lab.env, homeDir: lab.homeDir });
  const moved = { ...lab.env, APPIMAGE: path.join(lab.homeDir, 'Apps', 'OpenChamber.AppImage') };
  const result = await reconcileAppImageDesktopEntry({ env: moved, homeDir: lab.homeDir });

  assert.equal(result.changed, true);
  assert.match(await fs.readFile(lab.desktopPath, 'utf8'), new RegExp(`^TryExec=${moved.APPIMAGE}$`, 'm'));
});

test('an entry written by Gear Lever under the same name is left alone', async (t) => {
  const lab = await makeLab(t);
  const gearLever = '[Desktop Entry]\nName=OpenChamber (2.3.0)\nExec=env DESKTOPINTEGRATION=1 /home/u/AppImages/openchamber.appimage --no-sandbox %U\nStartupWMClass=openchamber\n';
  await writeEntry(lab.desktopPath, gearLever);

  const result = await reconcileAppImageDesktopEntry({ env: lab.env, homeDir: lab.homeDir });
  assert.deepEqual(result, { status: 'external', removed: false });
  assert.equal(await fs.readFile(lab.desktopPath, 'utf8'), gearLever);
});

test('a launch from Gear Lever withdraws our earlier entry', async (t) => {
  const lab = await makeLab(t);
  await reconcileAppImageDesktopEntry({ env: lab.env, homeDir: lab.homeDir });
  const result = await reconcileAppImageDesktopEntry({ env: { ...lab.env, DESKTOPINTEGRATION: '1' }, homeDir: lab.homeDir });

  assert.deepEqual(result, { status: 'external', removed: true });
  await assert.rejects(fs.access(lab.desktopPath));
  await assert.rejects(fs.access(lab.iconPath));
});

test('another entry claiming the window class withdraws ours', async (t) => {
  const lab = await makeLab(t);
  await reconcileAppImageDesktopEntry({ env: lab.env, homeDir: lab.homeDir });
  await writeEntry(path.join(path.dirname(lab.desktopPath), 'appimagekit_abc-OpenChamber.desktop'),
    '[Desktop Entry]\nName=OpenChamber\nExec=/opt/x.AppImage\nStartupWMClass=openchamber\n');

  const result = await reconcileAppImageDesktopEntry({ env: lab.env, homeDir: lab.homeDir });
  assert.deepEqual(result, { status: 'external', removed: true });
  await assert.rejects(fs.access(lab.desktopPath));
});

test('another entry that starts this AppImage counts as an integration', async (t) => {
  const lab = await makeLab(t);
  await writeEntry(path.join(lab.homeDir, 'data', 'applications', 'my-chamber.desktop'),
    `[Desktop Entry]\nName=Mine\nExec=${lab.env.APPIMAGE}\n`);

  const result = await reconcileAppImageDesktopEntry({ env: lab.env, homeDir: lab.homeDir });
  assert.equal(result.status, 'external');
  await assert.rejects(fs.access(lab.desktopPath));
});

test('a system-package entry under XDG_DATA_DIRS withdraws ours', async (t) => {
  const lab = await makeLab(t);
  await reconcileAppImageDesktopEntry({ env: lab.env, homeDir: lab.homeDir });
  await writeEntry(path.join(lab.systemDataDir, 'applications', 'openchamber.desktop'),
    '[Desktop Entry]\nName=OpenChamber\nExec=/usr/bin/openchamber\nStartupWMClass=openchamber\n');

  const result = await reconcileAppImageDesktopEntry({ env: lab.env, homeDir: lab.homeDir });
  assert.deepEqual(result, { status: 'external', removed: true });
  await assert.rejects(fs.access(lab.desktopPath));
  await assert.rejects(fs.access(lab.iconPath));
});

test('a packaged run with a system entry withdraws ours even without APPIMAGE', async (t) => {
  const lab = await makeLab(t);
  await reconcileAppImageDesktopEntry({ env: lab.env, homeDir: lab.homeDir });
  await writeEntry(path.join(lab.systemDataDir, 'applications', 'openchamber.desktop'),
    '[Desktop Entry]\nName=OpenChamber\nExec=/usr/bin/openchamber\nStartupWMClass=openchamber\n');
  const packaged = { ...lab.env, APPIMAGE: '', APPDIR: '' };

  const result = await reconcileAppImageDesktopEntry({ env: packaged, homeDir: lab.homeDir });
  assert.deepEqual(result, { status: 'external', removed: true });
  await assert.rejects(fs.access(lab.desktopPath));
});

test('a packaged run with no APPIMAGE does not treat an unrelated Exec as an integration', async (t) => {
  const lab = await makeLab(t);
  await reconcileAppImageDesktopEntry({ env: lab.env, homeDir: lab.homeDir });
  // A system entry that neither claims our window class nor starts the AppImage.
  await writeEntry(path.join(lab.systemDataDir, 'applications', 'other.desktop'),
    '[Desktop Entry]\nName=Other\nExec=/usr/bin/other\n');
  const packaged = { ...lab.env, APPIMAGE: '', APPDIR: '' };

  const result = await reconcileAppImageDesktopEntry({ env: packaged, homeDir: lab.homeDir });
  assert.deepEqual(result, { status: 'not-appimage' });
  // Our entry is left in place: no integration was proven.
  assert.match(await fs.readFile(lab.desktopPath, 'utf8'), /^StartupWMClass=openchamber$/m);
});

test("the AppImage's own bundled entry under APPDIR is not an integration", async (t) => {
  const lab = await makeLab(t);
  // The launcher prepends its mount's usr/share to XDG_DATA_DIRS, and the image
  // carries its own openchamber.desktop there; that is not another integration.
  const bundledEntry = path.join(lab.env.APPDIR, 'usr/share/applications/openchamber.desktop');
  await writeEntry(bundledEntry, '[Desktop Entry]\nName=OpenChamber\nExec=AppRun\nStartupWMClass=openchamber\n');
  const env = { ...lab.env, XDG_DATA_DIRS: path.join(lab.env.APPDIR, 'usr/share') };

  const result = await reconcileAppImageDesktopEntry({ env, homeDir: lab.homeDir });
  assert.deepEqual(result, { status: 'integrated', changed: true, desktopPath: lab.desktopPath });
  assert.match(await fs.readFile(lab.desktopPath, 'utf8'), /^StartupWMClass=openchamber$/m);
});

test('nothing is written outside an AppImage or without its icon', async (t) => {
  const lab = await makeLab(t);
  assert.deepEqual(
    await reconcileAppImageDesktopEntry({ env: { ...lab.env, APPIMAGE: '' }, homeDir: lab.homeDir }),
    { status: 'not-appimage' },
  );
  assert.deepEqual(
    await reconcileAppImageDesktopEntry({ env: { ...lab.env, APPDIR: path.join(lab.homeDir, 'missing') }, homeDir: lab.homeDir }),
    { status: 'no-icon' },
  );
  await assert.rejects(fs.access(lab.desktopPath));
});

test('Exec quotes the path the way the Desktop Entry spec asks', () => {
  const entry = buildAppImageDesktopEntry({ appImagePath: '/home/u/My "Apps"/100% $x.AppImage', iconPath: '/i.png' });
  assert.match(entry, /^Exec="\/home\/u\/My \\\\"Apps\\\\"\/100%% \\\\\$x\.AppImage" %U$/m);
  assert.match(entry, /^TryExec=\/home\/u\/My "Apps"\/100% \$x\.AppImage$/m);
});

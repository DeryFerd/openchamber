import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * OpenCode `serve --service` publishes its registration (url, pid, version,
 * password) so locally installed plugins can discover the server through
 * `@opencode/client`'s `discover()` — the mechanism plugins use to reach the
 * server for interactive permission prompts. The path follows OpenCode's XDG
 * state resolution, the same pattern the config readers use for
 * `XDG_CONFIG_HOME`.
 */
export const resolveOpenCodeServiceRegistrationPath = () =>
  path.join(process.env.XDG_STATE_HOME?.trim() || path.join(os.homedir(), '.local', 'state'), 'opencode', 'service.json');

/**
 * Remove the registration a stopped managed server published, so plugin
 * discovery does not keep probing a dead pid. A registration owned by another
 * server, or a missing, unreadable, or malformed file, is left alone.
 */
export const removeOpenCodeServiceRegistrationForPid = async (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  const registrationPath = resolveOpenCodeServiceRegistrationPath();
  try {
    const registration = JSON.parse(await fs.readFile(registrationPath, 'utf8'));
    if (registration?.pid !== pid) return false;
    await fs.rm(registrationPath, { force: true });
    return true;
  } catch {
    return false;
  }
};

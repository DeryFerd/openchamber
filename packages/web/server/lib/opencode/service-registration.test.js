import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { removeOpenCodeServiceRegistrationForPid, resolveOpenCodeServiceRegistrationPath } from './service-registration.js';

describe('service registration cleanup', () => {
  const previousStateHome = process.env.XDG_STATE_HOME;
  let stateDir;

  const writeRegistration = async (payload) => {
    await fs.mkdir(path.join(stateDir, 'opencode'), { recursive: true });
    await fs.writeFile(resolveOpenCodeServiceRegistrationPath(), JSON.stringify(payload));
  };

  afterEach(async () => {
    if (previousStateHome === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = previousStateHome;
    if (stateDir) await fs.rm(stateDir, { recursive: true, force: true });
    stateDir = undefined;
  });

  it('resolves the registration under XDG_STATE_HOME/opencode', () => {
    // Never point the afterEach cleanup at a shared directory: stateDir must
    // stay unset here so only purpose-made temp dirs get removed.
    process.env.XDG_STATE_HOME = path.join(os.tmpdir(), 'oc-service-registration-path-only');
    expect(resolveOpenCodeServiceRegistrationPath()).toBe(
      path.join(process.env.XDG_STATE_HOME, 'opencode', 'service.json')
    );
  });

  it('removes the registration that matches the stopped pid', async () => {
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-service-registration-'));
    process.env.XDG_STATE_HOME = stateDir;
    await writeRegistration({ url: 'http://127.0.0.1:45678', pid: 12345, version: '2.0.21', password: 'x' });

    await expect(removeOpenCodeServiceRegistrationForPid(12345)).resolves.toBe(true);
    await expect(fs.stat(resolveOpenCodeServiceRegistrationPath())).rejects.toThrow();
  });

  it('keeps a registration owned by another server', async () => {
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-service-registration-'));
    process.env.XDG_STATE_HOME = stateDir;
    await writeRegistration({ url: 'http://127.0.0.1:45678', pid: 99999, version: '2.0.21', password: 'x' });

    await expect(removeOpenCodeServiceRegistrationForPid(12345)).resolves.toBe(false);
    await expect(fs.stat(resolveOpenCodeServiceRegistrationPath())).resolves.toBeTruthy();
  });

  it('is a no-op when no registration exists', async () => {
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-service-registration-'));
    process.env.XDG_STATE_HOME = stateDir;

    await expect(removeOpenCodeServiceRegistrationForPid(12345)).resolves.toBe(false);
  });

  it('is a no-op when the registration is malformed', async () => {
    stateDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oc-service-registration-'));
    process.env.XDG_STATE_HOME = stateDir;
    await fs.mkdir(path.join(stateDir, 'opencode'), { recursive: true });
    await fs.writeFile(resolveOpenCodeServiceRegistrationPath(), '{not json');

    await expect(removeOpenCodeServiceRegistrationForPid(12345)).resolves.toBe(false);
    await expect(fs.stat(resolveOpenCodeServiceRegistrationPath())).resolves.toBeTruthy();
  });

  it('is a no-op for a missing or non-positive pid', async () => {
    await expect(removeOpenCodeServiceRegistrationForPid(undefined)).resolves.toBe(false);
    await expect(removeOpenCodeServiceRegistrationForPid(0)).resolves.toBe(false);
    await expect(removeOpenCodeServiceRegistrationForPid(-1)).resolves.toBe(false);
  });
});

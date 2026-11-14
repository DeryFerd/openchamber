import './opencodeConfigTestHome';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { listPluginDirFiles } from './opencodeConfig';

describe('plugin file listing', () => {
  test('lists a plugin file reached through a symlink', () => {
    const project = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-vscode-plugin-link-'));
    try {
      const pluginDir = path.join(project, '.opencode', 'plugins');
      fs.mkdirSync(pluginDir, { recursive: true });
      const target = path.join(project, 'external-plugin.js');
      fs.writeFileSync(target, 'export default {}', 'utf8');
      try {
        fs.symlinkSync(target, path.join(pluginDir, 'linked.js'), 'file');
      } catch (error) {
        // Windows needs Developer Mode or an elevated shell for a file link.
        // SAFETY: Node attaches the errno code to the Error it throws.
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'EPERM' || code === 'EACCES') return;
        throw error;
      }

      const listed = listPluginDirFiles(project).filter((file) => file.scope === 'project');
      assert.deepEqual(listed.map((file) => file.fileName), ['linked.js']);
    } finally {
      fs.rmSync(project, { recursive: true, force: true });
    }
  });
});
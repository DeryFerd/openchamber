import { describe, expect, test } from 'bun:test';
import { confirmCodePaths, resolveMarkdownFile } from './markdownFileReferences';

const probes = (values: string[]) => values.filter((value) => resolveMarkdownFile(value, '/repo') !== null);

describe('resolveMarkdownFile', () => {
  test('probes skip emails and digit-leading suffixes while keeping file references (#5330)', () => {
    const rejected = [
      'user@gmail.com', '@someone.ts',
      'gpt-5.4', '93.00', '3.49s', 'v1.2.3', '3.1.4', 'ls.1',
      'backup.7z', 'clip.3gp', 'data.001',
      'https://example.com/file.ts', '--flag.ts', '.', '..', 'a  b.ts',
    ];
    const accepted = [
      // A slash makes an `@` part of a path: scoped packages and pnpm stores.
      '@scope/package.json', 'node_modules/@types/node/index.d.ts',
      '.env', '.config.json', './src/entry.ts', '../src/parent.ts', '/repo/absolute.ts',
      'path with spaces/file name.ts', 'file.test.ts', 'my-file.tar.gz', 'a-b.c',
      'shader.frag2', 'component.d-ts', 'README', 'Dockerfile',
      // Still ambiguous with filenames that have letter-leading extensions.
      '150.ms', 'accounts.google.com', 'client.messages.create',
    ];
    expect(probes(rejected)).toEqual([]);
    expect(probes(accepted)).toEqual(accepted);
  });

  test('clicks keep the broad rules so file links never open a new window (#3858)', () => {
    for (const href of ['backup.7z', 'icon@2x.png', 'data.001', 'file:///repo/data.001']) {
      expect(resolveMarkdownFile(href, '/repo', 'click')).not.toBeNull();
    }
    expect(resolveMarkdownFile('file:///repo/data.001', '/repo', 'click')?.resolvedPath).toBe('/repo/data.001');
  });

  test('decodes the percent-encoded hrefs the markdown renderer hands over (#5660)', () => {
    const relative = resolveMarkdownFile('docs/%E4%B8%AD%E6%96%87/%E7%A4%BA%E4%BE%8B.md', '/repo', 'click');
    expect(relative?.resolvedPath).toBe('/repo/docs/中文/示例.md');
    const absolute = resolveMarkdownFile('/repo/docs/%E4%B8%AD%E6%96%87/%E7%A4%BA%E4%BE%8B.md', '/repo', 'click');
    expect(absolute?.resolvedPath).toBe('/repo/docs/中文/示例.md');
    // Valid escapes decode (%25 is a literal '%'); invalid sequences stay as written.
    expect(resolveMarkdownFile('/repo/docs/50%25off.md', '/repo', 'click')?.resolvedPath).toBe('/repo/docs/50%off.md');
    expect(resolveMarkdownFile('/repo/docs/%ZZbad.md', '/repo', 'click')?.resolvedPath).toBe('/repo/docs/%ZZbad.md');
  });

  test('code blocks probe only path-like tokens that pass the probe rules', async () => {
    const asked: string[] = [];
    const confirmed = await confirmCodePaths('gpt-5.4\nuser@gmail.com\nblock/entry.ts:7\n', '/repo', 80, async (raw) => {
      asked.push(raw);
      return `/repo/${raw.replace(/:\d+$/, '')}`;
    });
    expect(asked).toEqual(['block/entry.ts:7']);
    expect(confirmed.map((path) => path.raw)).toEqual(['block/entry.ts:7']);
  });
});

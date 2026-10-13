import React, { act } from 'react';
import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { GitBranch } from '@/lib/api/types';
import type { BranchComparisonRepository } from './useBranchComparisonBase';

// The revision is the Branch diff cache's invalidation key. A no-op status
// refresh must not move it; a real change must. See issue #4810.

const branches: GitBranch = {
  all: ['feature', 'main', 'remotes/origin/main'],
  current: 'feature',
  branches: {},
  defaultBranches: { origin: 'main' },
};

const repository: BranchComparisonRepository = {
  branches,
  remoteNames: new Set(['origin']),
  primaryRemote: 'origin',
  readContext: null,
};

test('the comparison revision follows status changes, not status fetches', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  const globals = {
    window: dom, document: dom.document, navigator: dom.navigator, location: dom.location,
    localStorage: dom.localStorage,
    Element: dom.Element, HTMLElement: dom.HTMLElement, Node: dom.Node,
    customElements: dom.customElements, CSSStyleSheet: dom.CSSStyleSheet,
    Event: dom.Event, CustomEvent: dom.CustomEvent,
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), IS_REACT_ACT_ENVIRONMENT: true,
  };
  for (const [name, value] of Object.entries(globals)) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const originalFetch = globalThis.fetch;
  // The hook's base detection reads /api/git/branch-base; let it fail quietly so
  // the test only observes the revision identity.
  globalThis.fetch = Object.assign(() => Promise.resolve(Response.json({ base: null })), originalFetch);

  const { createRoot } = await import('react-dom/client');
  const { I18nProvider } = await import('@/lib/i18n');
  const { useGitStore } = await import('@/stores/useGitStore');
  const { useBranchComparisonBase } = await import('./useBranchComparisonBase');

  type Capture = { current: ReturnType<typeof useBranchComparisonBase> | null };
  const captured: Capture = { current: null };
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  function Harness() {
    captured.current = useBranchComparisonBase('/repo', 'feature', true, repository);
    return null;
  }
  const render = () => act(async () => { root.render(<I18nProvider><Harness /></I18nProvider>); });
  const revision = () => captured.current?.revision;

  const seed = (patch: { lastStatusFetch?: number; lastStatusChange?: number }) => {
    const previous = useGitStore.getState().getDirectoryState('/repo');
    const directories = new Map(useGitStore.getState().directories);
    directories.set('/repo', {
      ...(previous ?? {
        isGitRepo: true, status: null, branches: null, log: null, identity: null, diffCache: new Map(),
        indexRevision: 0, lastRepoCheckAt: 0, lastStatusFetch: 0, lastStatusChange: 0,
        lastLogFetch: 0, lastBranchesFetch: 0, lastIdentityFetch: 0, logMaxCount: 25,
        isLoadingStatus: false, isLoadingLog: false, isLoadingBranches: false, isLoadingIdentity: false,
      }),
      lastStatusFetch: patch.lastStatusFetch ?? previous?.lastStatusFetch ?? 0,
      lastStatusChange: patch.lastStatusChange ?? previous?.lastStatusChange ?? 0,
    });
    useGitStore.setState({ directories });
  };

  try {
    seed({ lastStatusFetch: 100, lastStatusChange: 100 });
    await render();
    const baseline = revision();

    // A no-op refresh moves only the fetch timestamp.
    seed({ lastStatusFetch: 200 });
    await render();
    expect(revision()).toBe(baseline);

    // A real change moves the change signal.
    seed({ lastStatusChange: 300 });
    await render();
    expect(revision()).not.toBe(baseline);
  } finally {
    await act(async () => root.unmount());
    globalThis.fetch = originalFetch;
    await dom.happyDOM.abort();
    for (const [name, value] of originals) {
      if (value) Object.defineProperty(globalThis, name, value);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});

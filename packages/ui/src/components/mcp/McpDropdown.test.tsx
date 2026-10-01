import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test';
import { Window } from 'happy-dom';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import { opencodeClient } from '@/lib/opencode/client';
import { I18nProvider } from '@/lib/i18n';
import { useMcpConfigStore } from '@/stores/useMcpConfigStore';
import { useMcpStore } from '@/stores/useMcpStore';

type LoadMcpConfigs = (options?: { force?: boolean; directory?: string | null }) => Promise<boolean>;

// Reading MCP status boots the directory's whole stdio server fleet as an
// OpenCode side effect, so these tests spy on the status read itself and
// assert which mounts are allowed to issue it.
describe('MCP dropdown status reads', () => {
  let root: Root | null = null;
  let restoreGlobals: () => void;
  let listSpy: ReturnType<typeof spyOn>;
  let originalLoadMcpConfigs: LoadMcpConfigs;
  let dom: Window;
  const loadMcpConfigs = mock(async () => true);

  const renderNode = async (element: React.ReactNode) => {
    const host = document.createElement('div');
    document.body.append(host);
    const mounted = createRoot(host);
    root = mounted;
    await act(async () => {
      mounted.render(
        <I18nProvider>
          <TooltipProvider>
            {element}
          </TooltipProvider>
        </I18nProvider>,
      );
    });
    return host;
  };

  beforeEach(() => {
    dom = new Window();
    const globals = {
      window: dom,
      document: dom.document,
      Event: dom.Event,
      PointerEvent: dom.PointerEvent,
      KeyboardEvent: dom.KeyboardEvent,
      HTMLElement: dom.HTMLElement,
      Element: dom.Element,
      Node: dom.Node,
      IS_REACT_ACT_ENVIRONMENT: true,
    };
    const descriptors = Object.getOwnPropertyDescriptors(globalThis);
    Object.assign(globalThis, globals);
    restoreGlobals = () => {
      for (const key of Object.keys(globals)) {
        const descriptor = descriptors[key];
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    };

    useMcpStore.setState({
      byDirectory: {},
      diagnosticsByDirectory: {},
      loadingKeys: {},
      lastErrorKeys: {},
      refreshedAtKeys: {},
    });
    originalLoadMcpConfigs = useMcpConfigStore.getState().loadMcpConfigs;
    useMcpConfigStore.setState({ loadMcpConfigs });
    listSpy = spyOn(opencodeClient, 'listMcpServers').mockImplementation(async () => []);
  });

  afterEach(async () => {
    if (root) {
      const mounted = root;
      root = null;
      await act(async () => mounted.unmount());
    }
    listSpy.mockRestore();
    useMcpConfigStore.setState({ loadMcpConfigs: originalLoadMcpConfigs });
    restoreGlobals();
  });

  test('inactive content does not read MCP status on mount', async () => {
    const { McpDropdownContent } = await import('./McpDropdown');
    await renderNode(<McpDropdownContent active={false} />);
    await act(async () => {});

    expect(listSpy.mock.calls.length).toBe(0);
  });

  test('active content reads MCP status on mount', async () => {
    const { McpDropdownContent } = await import('./McpDropdown');
    await renderNode(<McpDropdownContent active={true} />);
    await act(async () => {});

    expect(listSpy.mock.calls.length).toBe(1);
  });

  test('closed dropdown does not read MCP status on mount', async () => {
    const { McpDropdown } = await import('./McpDropdown');
    await renderNode(<McpDropdown headerIconButtonClass="" />);
    await act(async () => {});

    expect(listSpy.mock.calls.length).toBe(0);
  });
});

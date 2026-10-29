import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Window } from 'happy-dom';
import { getDefaultTheme } from '@/lib/theme/themes';
import { useUIStore } from '@/stores/useUIStore';
import type { HtmlRenderTheme } from './htmlRender';

let dark = false;

mock.module('@/contexts/useThemeSystem', () => ({
    useThemeSystem: () => ({ currentTheme: getDefaultTheme(dark) }),
}));

const { useHtmlRenderTheme } = await import('./useHtmlRenderTheme');

const Probe = (): null => {
    captured.push(useHtmlRenderTheme());
    return null;
};

const captured: HtmlRenderTheme[] = [];

describe('useHtmlRenderTheme (#5884)', () => {
    let dom: Window;
    let root: Root;

    beforeEach(() => {
        dark = false;
        captured.length = 0;
        dom = new Window({ url: 'http://localhost/' });
        Object.assign(globalThis, {
            window: dom, document: dom.document, navigator: dom.navigator,
            getComputedStyle: dom.window.getComputedStyle.bind(dom.window),
            requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
            cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
            IS_REACT_ACT_ENVIRONMENT: true,
        });
        useUIStore.setState({ fontSize: 100 });
        dom.document.documentElement.style.fontSize = '16px';
        root = createRoot(document.createElement('div'));
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        dom.happyDOM.close();
    });

    const render = async () => {
        await act(async () => root.render(<Probe />));
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)); });
    };

    test('follows the root font when the interface size changes after the render', async () => {
        await render();
        expect(captured.at(-1)?.variables['--oc-rem']).toBe('16px');

        // The store changes first (the hook recomputes whatever the root holds
        // right now); the root font lands afterwards, the way the theme's own
        // effects write it.
        useUIStore.setState({ fontSize: 130 });
        dom.document.documentElement.style.fontSize = '20.8px';
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)); });

        expect(captured.at(-1)?.variables['--oc-rem']).toBe('20.8px');
        expect(captured.at(-1)?.variables['--oc-text']).toBe(`${0.875 * 20.8}px`);
    });

    test('follows a theme switch', async () => {
        await render();
        expect(captured.at(-1)?.appearance).toBe('light');

        dark = true;
        useUIStore.setState({ fontSize: 101 });
        await act(async () => { await new Promise((resolve) => setTimeout(resolve, 40)); });

        expect(captured.at(-1)?.appearance).toBe('dark');
    });
});

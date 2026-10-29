import React from 'react';
import { useThemeSystem } from '@/contexts/useThemeSystem';
import { useFontPreferences } from '@/hooks/useFontPreferences';
import { useUIStore } from '@/stores/useUIStore';
import { htmlRenderTheme, type HtmlRenderTheme } from './htmlRender';

const DEFAULT_SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
const DEFAULT_MONO = 'ui-monospace, "SFMono-Regular", Menlo, monospace';

/** The user's font settings land on the root as these variables. */
const readRenderMetrics = () => {
    const style = getComputedStyle(document.documentElement);
    const rem = Number.parseFloat(style.fontSize) || 16;
    // The chat's body text size, which the styles set in rem (0.875, and
    // 1 on phones).
    const text = (Number.parseFloat(style.getPropertyValue('--text-markdown')) || 0.875) * rem;
    return {
        rem,
        text,
        sans: style.getPropertyValue('--font-sans').trim() || DEFAULT_SANS,
        mono: style.getPropertyValue('--font-mono').trim() || DEFAULT_MONO,
    };
};

/** The app theme as the page's variables, following theme and interface size switches live. */
function useHtmlRenderTheme(): HtmlRenderTheme {
    const { currentTheme } = useThemeSystem();
    // The interface size setting scales the root font, and the app's
    // controls with it; the font settings land on the root as variables.
    const interfaceSize = useUIStore((state) => state.fontSize);
    const { uiFont, monoFont, customUiFont, customMonoFont } = useFontPreferences();
    const uiFontWeight = useUIStore((state) => state.uiFontWeight);
    const [theme, setTheme] = React.useState(() => htmlRenderTheme(currentTheme, readRenderMetrics()));
    // The root font and the font variables are written by the theme's own
    // effects, which run after this component renders — a read during render
    // caches the previous size and, with the React Compiler pruning every
    // dependency the callback does not read (#5884), nothing recomputes it
    // later. So the metrics are read on the frame after the theme, the
    // interface size or the font settings change, once those writes have
    // landed.
    React.useEffect(() => {
        const frame = requestAnimationFrame(() => {
            setTheme(htmlRenderTheme(currentTheme, readRenderMetrics()));
        });
        return () => cancelAnimationFrame(frame);
    }, [currentTheme, interfaceSize, uiFont, monoFont, customUiFont, customMonoFont, uiFontWeight]);
    return theme;
}

export { useHtmlRenderTheme };

'use client';

import { useEffect, useState } from 'react';

/**
 * Resolves CSS custom-property values from :root on mount.
 *
 * Chart libraries (recharts, jsPDF, etc.) require hex/rgb *string* values
 * on their props — they do not read CSS variables at paint time. This
 * hook bridges that gap: pass a map of token-name → SSR-safe fallback,
 * and the returned object holds spec-literal hex values on the server
 * render and the computed browser values after mount.
 *
 * Keys must match the CSS custom-property name without the leading `--`
 * (e.g. `ink` → `--ink`, `muted-foreground` → `--muted-foreground`).
 *
 * Usage:
 *   const chartColors = useResolvedTokens({
 *     ink: '#111210',
 *     gold: '#C8A24B',
 *     border: '#DFDACB',
 *   });
 *   // chartColors.ink === '#111210' during SSR,
 *   //                 === resolved CSS value post-mount.
 */
export function useResolvedTokens<T extends Record<string, string>>(
  defaults: T,
): T {
  const [tokens, setTokens] = useState<T>(defaults);

  useEffect(() => {
    const style = getComputedStyle(document.documentElement);
    const resolved = Object.fromEntries(
      Object.entries(defaults).map(([key, fallback]) => {
        const raw = style.getPropertyValue(`--${key}`).trim();
        return [key, raw || fallback];
      }),
    ) as T;
    setTokens(resolved);
  }, []);

  return tokens;
}

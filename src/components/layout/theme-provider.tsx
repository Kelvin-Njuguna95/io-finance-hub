'use client';

import * as React from 'react';
import { ThemeProvider as NextThemesProvider } from 'next-themes';

type Props = Omit<React.ComponentProps<typeof NextThemesProvider>, 'children'> & {
  children: React.ReactNode;
};

/**
 * App-wide theme provider (client). Wraps `next-themes` with the Finance
 * Hub defaults: class-based `.dark` variant, system default, stored in
 * localStorage under `io-theme`.
 */
export function ThemeProvider({ children, ...props }: Props) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey="io-theme"
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}

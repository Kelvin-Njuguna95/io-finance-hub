import * as React from 'react';

/**
 * Thin layout wrapper for the /reports/* route group. The dashboard
 * layout above this provides sidebar/topbar; this layer just passes
 * children through and exists so per-report pages can opt into shared
 * UI in future commits without restructuring the route tree.
 */
export default function ReportsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

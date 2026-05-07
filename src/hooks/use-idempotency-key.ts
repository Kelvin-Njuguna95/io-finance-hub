import { useState } from 'react';

/**
 * Returns a stable UUID for the lifetime of the calling component's mount.
 * Submitting a form twice (double-click, slow network retry) re-uses the
 * same key, which the server's partial unique index on idempotency_key
 * rejects as SQLSTATE 23505 — letting the route return the original row
 * instead of creating a duplicate.
 *
 * Re-mounting the form (close + reopen, navigate away and back) generates
 * a fresh key, so a deliberate second submission of the same data still
 * creates a new row.
 *
 * useState's lazy initializer runs exactly once per mount; the returned
 * value is never replaced. crypto.randomUUID is available in all supported
 * browsers and Node ≥ 19; the project pins Node ≥ 20.
 */
export function useIdempotencyKey(): string {
  const [key] = useState(() => crypto.randomUUID());
  return key;
}

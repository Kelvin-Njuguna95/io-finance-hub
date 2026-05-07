import { useCallback, useState } from 'react';

/**
 * Returns `[key, regenerate]`. The `key` is a UUID stable across renders
 * until the caller explicitly invokes `regenerate()`, which mints a fresh
 * UUID and triggers a re-render.
 *
 * Why a tuple, not just a string: shadcn-style dialogs in this codebase
 * stay mounted while closed (`<Dialog open={open}>` toggles visibility,
 * not mount). A keep-mounted form would otherwise hold the same key for
 * the whole session — a second deliberate submission of new data after
 * a successful save would carry the prior key, hit the partial unique
 * index, return the old row, and silently mislead the user into thinking
 * they recorded something new. Callers therefore regenerate after each
 * successful submit (or on dialog open) to break that cycle.
 *
 * For page-level forms that navigate away on success (`router.push`), the
 * default lazy-init is enough — no manual regeneration needed.
 *
 * crypto.randomUUID is available in all supported browsers and Node ≥ 19;
 * the project pins Node ≥ 20.
 */
export function useIdempotencyKey(): readonly [string, () => string] {
  const [key, setKey] = useState(() => crypto.randomUUID());
  const regenerate = useCallback(() => {
    const next = crypto.randomUUID();
    setKey(next);
    return next;
  }, []);
  return [key, regenerate];
}

export function getUserErrorMessage(error?: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const message = typeof error === 'string'
    ? error
    : (error && typeof error === 'object' && 'message' in error ? String((error as { message?: string }).message || '') : '');

  const normalized = message.toLowerCase();

  if (!normalized) return fallback;
  if (normalized.includes('duplicate key') || normalized.includes('already exists')) {
    return 'A record already exists for this period. Check if it was already submitted.';
  }
  if (normalized.includes('foreign key') || normalized.includes('is still referenced')) {
    return 'This record is linked to other data and cannot be deleted. Contact support.';
  }
  if (normalized.includes('row-level security') || normalized.includes('permission') || normalized.includes('not authorized')) {
    return "You don't have permission to perform this action.";
  }
  if (normalized.includes('failed to fetch') || normalized.includes('network') || normalized.includes('load failed')) {
    return 'Connection failed. Check your internet and try again.';
  }

  return message || fallback;
}

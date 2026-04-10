export function getUserErrorMessage(error?: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (typeof error === 'string') {
    return mapErrorToMessage(error, fallback);
  }
  if (error instanceof Error) {
    return mapErrorToMessage(error.message, fallback);
  }
  if (typeof error === 'object' && error !== null) {
    const e = error as Record<string, unknown>;
    if (typeof e.message === 'string') {
      return mapErrorToMessage(e.message, fallback);
    }
    if (typeof e.error === 'string') {
      return mapErrorToMessage(e.error, fallback);
    }
  }
  return fallback;
}

function mapErrorToMessage(msg: string, fallback: string): string {
  if (msg.includes('duplicate key')) return 'A record already exists for this period. Check if it was already submitted.';
  if (msg.includes('violates foreign key')) return 'This record is linked to other data and cannot be deleted.';
  if (msg.includes('violates row-level security') || msg.includes('new row violates')) return "You don't have permission to perform this action.";
  if (msg.includes('violates check constraint')) return 'The data entered is invalid. Please check all fields and try again.';
  if (msg.includes('not found') || msg.includes('PGRST116')) return 'The requested record was not found.';
  if (msg.includes('JWT') || msg.includes('token')) return 'Your session has expired. Please refresh the page and try again.';
  if (msg.includes('MISC_GATE_BLOCKED') || msg.includes('BUDGET_GATE_BLOCKED')) return msg;
  if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) return 'Connection failed. Check your internet connection and try again.';
  return fallback;
}

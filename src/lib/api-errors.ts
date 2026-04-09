import { NextResponse } from 'next/server';
import { getUserErrorMessage } from '@/lib/errors';

export class ApiRouteError extends Error {
  status: number;
  code: string;

  constructor(message: string, status = 500, code = 'INTERNAL_ERROR') {
    super(message);
    this.name = 'ApiRouteError';
    this.status = status;
    this.code = code;
  }
}

export function apiErrorResponse(
  error: unknown,
  fallbackMessage = 'Request failed. Please try again.',
  fallbackCode = 'INTERNAL_ERROR'
) {
  if (error instanceof ApiRouteError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }

  const safeMessage = getUserErrorMessage(error, fallbackMessage);
  return NextResponse.json({ error: safeMessage, code: fallbackCode }, { status: 500 });
}

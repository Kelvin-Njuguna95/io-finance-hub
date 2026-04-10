'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

export default function ReportsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Reports page error boundary:', error);
  }, [error]);

  return (
    <div className="p-8">
      <div className="mx-auto max-w-xl rounded-lg border border-slate-200 bg-white p-6 text-center shadow-sm">
        <p className="text-base font-semibold text-slate-900">Unable to load this report</p>
        <p className="mt-2 text-sm text-slate-500">
          Something unexpected happened while loading report data. Please try again.
        </p>
        <Button className="mt-4" onClick={reset}>
          Retry
        </Button>
      </div>
    </div>
  );
}

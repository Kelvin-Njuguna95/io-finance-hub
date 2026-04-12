'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error('Global application error:', error?.message, error?.stack, error?.digest);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <Card className="w-full max-w-xl border-danger/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-danger-soft-foreground">
            <AlertTriangle className="h-5 w-5" />
            Something went wrong
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-foreground/80">
            An unexpected error occurred. You can try again, or return to the dashboard.
          </p>
          <div className="flex gap-2">
            <Button onClick={() => unstable_retry()}>Try again</Button>
            <Button variant="outline" onClick={() => (window.location.href = '/')}>Go Home</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

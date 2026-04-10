'use client';

import { useEffect } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function DashboardError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error('Dashboard segment error:', error?.message, error?.stack, error?.digest);
  }, [error]);

  return (
    <div className="p-6">
      <Card className="border-rose-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-rose-700">
            <AlertTriangle className="h-5 w-5" />
            Dashboard content failed to load
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-foreground/80">
            We hit an unexpected issue while loading this section. Please try again.
          </p>
          <Button onClick={() => unstable_retry()}>Try again</Button>
        </CardContent>
      </Card>
    </div>
  );
}

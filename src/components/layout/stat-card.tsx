import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { LucideIcon } from 'lucide-react';

interface StatCardProps {
  title: string;
  value: string;
  subtitle?: string;
  icon?: LucideIcon;
  trend?: { value: string; positive: boolean };
  className?: string;
}

export function StatCard({ title, value, subtitle, icon: Icon, trend, className }: StatCardProps) {
  return (
    <Card className={cn('', className)}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-xs font-medium text-neutral-500">{title}</p>
            <p className="text-2xl font-semibold tracking-tight">{value}</p>
            {subtitle && <p className="text-xs text-neutral-400">{subtitle}</p>}
            {trend && (
              <p className={cn(
                'text-xs font-medium',
                trend.positive ? 'text-green-600' : 'text-red-600'
              )}>
                {trend.positive ? '+' : ''}{trend.value}
              </p>
            )}
          </div>
          {Icon && (
            <div className="rounded-md bg-neutral-100 p-2">
              <Icon className="h-4 w-4 text-neutral-600" />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

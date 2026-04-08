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
    <Card className={cn('io-card', className)}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-[11px] font-medium uppercase tracking-wider text-slate-400">{title}</p>
            <p className="text-2xl font-bold tracking-tight text-[#0f172a]">{value}</p>
            {subtitle && <p className="text-xs text-slate-400">{subtitle}</p>}
            {trend && (
              <p className={cn(
                'text-xs font-medium',
                trend.positive ? 'text-emerald-600' : 'text-rose-600'
              )}>
                {trend.positive ? '+' : ''}{trend.value}
              </p>
            )}
          </div>
          {Icon && (
            <div className="rounded-lg bg-slate-100 p-2">
              <Icon className="h-4 w-4 text-slate-500" />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

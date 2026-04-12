import type React from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';

export type DashboardAlertVariant = 'info' | 'success' | 'warning' | 'error';

const variantStyles: Record<DashboardAlertVariant, { icon: React.ComponentType<{ className?: string }>; className: string }> = {
  info: { icon: Info, className: 'border-blue-200 bg-blue-50 text-blue-800' },
  success: { icon: CheckCircle2, className: 'border-success/30 bg-success-soft/50 text-success-soft-foreground' },
  warning: { icon: AlertTriangle, className: 'border-warning/30 bg-warning-soft/50 text-warning-soft-foreground' },
  error: { icon: AlertCircle, className: 'border-danger/30 bg-danger-soft/50 text-danger-soft-foreground' },
};

type Props = {
  title?: string;
  description: React.ReactNode;
  variant?: DashboardAlertVariant;
  className?: string;
};

export function DashboardAlert({ title, description, variant = 'info', className }: Props) {
  const { icon: Icon, className: variantClass } = variantStyles[variant];

  return (
    <Alert className={`${variantClass} ${className ?? ''}`.trim()}>
      <Icon className="h-4 w-4" />
      {title ? <AlertTitle>{title}</AlertTitle> : null}
      <AlertDescription className="text-sm text-current">{description}</AlertDescription>
    </Alert>
  );
}

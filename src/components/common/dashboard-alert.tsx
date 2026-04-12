import type React from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';

export type DashboardAlertVariant = 'info' | 'success' | 'warning' | 'error';

const variantStyles: Record<DashboardAlertVariant, { icon: React.ComponentType<{ className?: string }>; className: string }> = {
  info: { icon: Info, className: 'border-info/40 bg-info-soft text-info-soft-foreground' },
  success: { icon: CheckCircle2, className: 'border-success/40 bg-success-soft text-success-soft-foreground' },
  warning: { icon: AlertTriangle, className: 'border-warning/40 bg-warning-soft text-warning-soft-foreground' },
  error: { icon: AlertCircle, className: 'border-danger/40 bg-danger-soft text-danger-soft-foreground' },
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

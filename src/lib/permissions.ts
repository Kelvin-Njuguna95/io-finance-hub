import type { UserRole } from '@/types/database';

export function canSubmitProjectBudget(role?: UserRole | null): boolean {
  return role === 'cfo' || role === 'accountant' || role === 'project_manager' || role === 'team_leader';
}

export function canSubmitDepartmentBudget(role?: UserRole | null): boolean {
  return role === 'cfo' || role === 'accountant';
}

export function canCreateExpense(role?: UserRole | null): boolean {
  return role === 'cfo' || role === 'accountant';
}

export function canCreateInvoiceOrPayment(role?: UserRole | null): boolean {
  return role === 'cfo' || role === 'accountant';
}

export function canCreateWithdrawal(role?: UserRole | null): boolean {
  return role === 'cfo' || role === 'accountant';
}

export function canEditSettings(role?: UserRole | null): boolean {
  return role === 'cfo';
}

export function canViewSettings(role?: UserRole | null): boolean {
  return role === 'cfo' || role === 'accountant';
}

export function canViewAudit(role?: UserRole | null): boolean {
  return role === 'cfo' || role === 'accountant';
}

export function canViewRedFlags(role?: UserRole | null): boolean {
  return role === 'cfo' || role === 'accountant' || role === 'project_manager';
}

export function canResolveRedFlags(role?: UserRole | null): boolean {
  return role === 'cfo';
}

export function canManageAgentCounts(role?: UserRole | null): boolean {
  return role === 'cfo' || role === 'accountant' || role === 'team_leader';
}

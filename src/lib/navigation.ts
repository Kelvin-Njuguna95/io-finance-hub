import type { UserRole } from '@/types/database';
import {
  LayoutDashboard,
  FileText,
  DollarSign,
  Receipt,
  ArrowDownToLine,
  PieChart,
  Users,
  Building2,
  Settings,
  AlertTriangle,
  CalendarCheck,
  ClipboardList,
  TrendingUp,
  type LucideIcon,
} from 'lucide-react';

export interface NavItem {
  title: string;
  href: string;
  icon: LucideIcon;
  badge?: string;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

const cfoNav: NavGroup[] = [
  {
    title: 'Overview',
    items: [
      { title: 'Dashboard', href: '/', icon: LayoutDashboard },
      { title: 'Red Flags', href: '/red-flags', icon: AlertTriangle },
    ],
  },
  {
    title: 'Financial Operations',
    items: [
      { title: 'Budgets', href: '/budgets', icon: FileText },
      { title: 'Expenses', href: '/expenses', icon: Receipt },
      { title: 'Revenue', href: '/revenue', icon: DollarSign },
      { title: 'Withdrawals', href: '/withdrawals', icon: ArrowDownToLine },
    ],
  },
  {
    title: 'Reports & Analysis',
    items: [
      { title: 'P&L Reports', href: '/reports/pnl', icon: TrendingUp },
      { title: 'Project Profitability', href: '/reports/profitability', icon: PieChart },
      { title: 'Profit Share', href: '/profit-share', icon: PieChart },
      { title: 'Budget vs Actual', href: '/reports/budget-vs-actual', icon: ClipboardList },
    ],
  },
  {
    title: 'Administration',
    items: [
      { title: 'Month Closure', href: '/month-closure', icon: CalendarCheck },
      { title: 'Projects', href: '/projects', icon: Building2 },
      { title: 'Departments', href: '/departments', icon: Building2 },
      { title: 'Users', href: '/users', icon: Users },
      { title: 'Settings', href: '/settings', icon: Settings },
    ],
  },
];

const accountantNav: NavGroup[] = [
  {
    title: 'Overview',
    items: [
      { title: 'Dashboard', href: '/', icon: LayoutDashboard },
    ],
  },
  {
    title: 'Financial Operations',
    items: [
      { title: 'Budgets', href: '/budgets', icon: FileText },
      { title: 'Expenses', href: '/expenses', icon: Receipt },
      { title: 'Revenue', href: '/revenue', icon: DollarSign },
      { title: 'Withdrawals', href: '/withdrawals', icon: ArrowDownToLine },
    ],
  },
  {
    title: 'Reports',
    items: [
      { title: 'P&L Reports', href: '/reports/pnl', icon: TrendingUp },
      { title: 'Budget vs Actual', href: '/reports/budget-vs-actual', icon: ClipboardList },
      { title: 'Agent Counts', href: '/agent-counts', icon: Users },
    ],
  },
];

const teamLeaderNav: NavGroup[] = [
  {
    title: 'Overview',
    items: [
      { title: 'Dashboard', href: '/', icon: LayoutDashboard },
    ],
  },
  {
    title: 'My Projects',
    items: [
      { title: 'Budgets', href: '/budgets', icon: FileText },
      { title: 'Agent Counts', href: '/agent-counts', icon: Users },
    ],
  },
];

const projectManagerNav: NavGroup[] = [
  {
    title: 'Overview',
    items: [
      { title: 'Dashboard', href: '/', icon: LayoutDashboard },
    ],
  },
  {
    title: 'My Department',
    items: [
      { title: 'Budgets', href: '/budgets', icon: FileText },
    ],
  },
];

export function getNavigation(role: UserRole): NavGroup[] {
  switch (role) {
    case 'cfo':
      return cfoNav;
    case 'accountant':
      return accountantNav;
    case 'team_leader':
      return teamLeaderNav;
    case 'project_manager':
      return projectManagerNav;
  }
}

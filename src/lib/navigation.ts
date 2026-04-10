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
  BarChart3,
  Target,
  LineChart,
  ListChecks,
  GitCompareArrows,
  ScrollText,
  Bell,
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
      { title: 'Expense Queue', href: '/expenses/queue', icon: ListChecks },
      { title: 'Variance Dashboard', href: '/expenses/variance', icon: GitCompareArrows },
      { title: 'Revenue', href: '/revenue', icon: DollarSign },
      { title: 'Invoices', href: '/invoices', icon: FileText },
      { title: 'Withdrawals', href: '/withdrawals', icon: ArrowDownToLine },
    ],
  },
  {
    title: 'Administration',
    items: [
      { title: 'Misc Reports', href: '/misc', icon: ClipboardList },
      { title: 'Agent Counts', href: '/agent-counts', icon: Users },
      { title: 'Month Closure', href: '/month-closure', icon: CalendarCheck },
      { title: 'Projects', href: '/projects', icon: Building2 },
      { title: 'Departments', href: '/departments', icon: Building2 },
      { title: 'Users', href: '/users', icon: Users },
      { title: 'Settings', href: '/settings', icon: Settings },
    ],
  },
  {
    title: 'Controls',
    items: [
      { title: 'Audit Log', href: '/audit', icon: ScrollText },
      { title: 'Notifications', href: '/notifications', icon: Bell },
    ],
  },
  {
    title: 'Reports & Analysis',
    items: [
      { title: 'Monthly P&L', href: '/reports/monthly', icon: FileText },
      { title: 'P&L Reports', href: '/reports/pnl', icon: TrendingUp },
      { title: 'Profitability', href: '/reports/profitability', icon: PieChart },
      { title: 'Trends & Analytics', href: '/reports/trends', icon: LineChart },
      { title: 'Project Comparison', href: '/reports/projects', icon: BarChart3 },
      { title: 'Budget Accuracy', href: '/reports/budget-accuracy', icon: Target },
      { title: 'Outstanding Receivables', href: '/reports/outstanding', icon: DollarSign },
      { title: 'Budget vs Actual', href: '/reports/budget-vs-actual', icon: ClipboardList },
      { title: 'Profit Share', href: '/profit-share', icon: PieChart },
    ],
  },
];

const accountantNav: NavGroup[] = [
  // Audit note (Phase 4): accountant budget visibility is aligned with server-enforced budget route permissions.
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
      { title: 'Expense Queue', href: '/expenses/queue', icon: ListChecks },
      { title: 'Revenue', href: '/revenue', icon: DollarSign },
      { title: 'Invoices', href: '/invoices', icon: FileText },
      { title: 'Withdrawals', href: '/withdrawals', icon: ArrowDownToLine },
    ],
  },
  {
    title: 'Administration',
    items: [
      { title: 'Misc Reports', href: '/misc', icon: ClipboardList },
    ],
  },
  {
    title: 'Controls',
    items: [
      { title: 'Audit Log', href: '/audit', icon: ScrollText },
      { title: 'Notifications', href: '/notifications', icon: Bell },
    ],
  },
  {
    title: 'Reports',
    items: [
      { title: 'Monthly P&L', href: '/reports/monthly', icon: FileText },
      { title: 'P&L Reports', href: '/reports/pnl', icon: TrendingUp },
      { title: 'Profitability', href: '/reports/profitability', icon: PieChart },
      { title: 'Trends & Analytics', href: '/reports/trends', icon: LineChart },
      { title: 'Project Comparison', href: '/reports/projects', icon: BarChart3 },
      { title: 'Budget Accuracy', href: '/reports/budget-accuracy', icon: Target },
      { title: 'Outstanding Receivables', href: '/reports/outstanding', icon: DollarSign },
      { title: 'Budget vs Actual', href: '/reports/budget-vs-actual', icon: ClipboardList },
    ],
  },
];

const teamLeaderNav: NavGroup[] = [
  {
    title: 'Overview',
    items: [
      { title: 'Dashboard', href: '/', icon: LayoutDashboard },
      { title: 'Notifications', href: '/notifications', icon: Bell },
    ],
  },
  {
    title: 'My Projects',
    items: [
      { title: 'Project Financials', href: '/financials', icon: TrendingUp },
      { title: 'Budgets', href: '/budgets', icon: FileText },
      { title: 'Agent Counts', href: '/agent-counts', icon: Users },
    ],
  },
  {
    title: 'Reports',
    items: [
      { title: 'Monthly P&L', href: '/reports/monthly', icon: FileText },
      { title: 'Profitability', href: '/reports/profitability', icon: PieChart },
      { title: 'Trends & Analytics', href: '/reports/trends', icon: LineChart },
      { title: 'Budget Accuracy', href: '/reports/budget-accuracy', icon: Target },
    ],
  },
];

const projectManagerNav: NavGroup[] = [
  {
    title: 'Overview',
    items: [
      { title: 'Dashboard', href: '/', icon: LayoutDashboard },
      { title: 'Notifications', href: '/notifications', icon: Bell },
      { title: 'Misc Reports', href: '/misc', icon: ClipboardList },
    ],
  },
  {
    title: 'Financial Operations',
    items: [
      { title: 'Budget Reviews', href: '/budgets', icon: ClipboardList },
      { title: 'Revenue', href: '/revenue', icon: DollarSign },
    ],
  },
  {
    title: 'Reports',
    items: [
      { title: 'Monthly P&L', href: '/reports/monthly', icon: FileText },
      { title: 'P&L Reports', href: '/reports/pnl', icon: TrendingUp },
      { title: 'Profitability', href: '/reports/profitability', icon: PieChart },
      { title: 'Trends & Analytics', href: '/reports/trends', icon: LineChart },
      { title: 'Budget Accuracy', href: '/reports/budget-accuracy', icon: Target },
      { title: 'Budget vs Actual', href: '/reports/budget-vs-actual', icon: ClipboardList },
      { title: 'Profit Share', href: '/profit-share', icon: PieChart },
    ],
  },
  {
    title: 'Administration',
    items: [
      { title: 'Projects', href: '/projects', icon: Building2 },
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
    case 'department_head':
      return accountantNav;
    default:
      return accountantNav;
  }
}

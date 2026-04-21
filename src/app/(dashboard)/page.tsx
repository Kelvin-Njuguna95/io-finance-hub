'use client';

import { useUser } from '@/hooks/use-user';
import { CfoDashboard } from './_components/cfo-dashboard';
import { AccountantDashboard } from './_components/accountant-dashboard';
import { TeamLeaderDashboard } from './_components/team-leader-dashboard';
import { ProjectManagerDashboard } from './_components/project-manager-dashboard';
import DashboardLoading from './loading';

export default function DashboardPage() {
  const { user, loading } = useUser();

  if (loading) {
    // Reuse the route-level loading skeleton so the pre-hydration
    // fallback and the post-hydration useUser() loading state render
    // identically. Avoids the two-flash on slow networks.
    return <DashboardLoading />;
  }

  if (!user) {
    // Redirect handled by middleware, show nothing briefly
    return null;
  }

  switch (user.role) {
    case 'cfo':
      return <CfoDashboard />;
    case 'accountant':
      return <AccountantDashboard />;
    case 'team_leader':
      return <TeamLeaderDashboard userId={user.id} />;
    case 'project_manager':
      return <ProjectManagerDashboard userId={user.id} />;
    default:
      return null;
  }
}

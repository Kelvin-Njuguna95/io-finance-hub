'use client';

import { useUser } from '@/hooks/use-user';
import { CfoDashboard } from './_components/cfo-dashboard';
import { AccountantDashboard } from './_components/accountant-dashboard';
import { TeamLeaderDashboard } from './_components/team-leader-dashboard';
import { ProjectManagerDashboard } from './_components/project-manager-dashboard';
import { Skeleton } from '@/components/ui/skeleton';

export default function DashboardPage() {
  const { user, loading } = useUser();

  if (loading) {
    return (
      <div className="p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Skeleton className="h-64 w-full rounded-lg" />
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      </div>
    );
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

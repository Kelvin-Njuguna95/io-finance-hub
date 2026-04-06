import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { CfoDashboard } from './_components/cfo-dashboard';
import { AccountantDashboard } from './_components/accountant-dashboard';
import { TeamLeaderDashboard } from './_components/team-leader-dashboard';
import { ProjectManagerDashboard } from './_components/project-manager-dashboard';

export default async function DashboardPage() {
  const supabase = await createClient();
  const { data: { user: authUser } } = await supabase.auth.getUser();

  if (!authUser) redirect('/login');

  const { data: user } = await supabase
    .from('users')
    .select('*')
    .eq('id', authUser.id)
    .single();

  if (!user) redirect('/login');

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
      redirect('/login');
  }
}

import type { SupabaseClient } from '@supabase/supabase-js';

export async function getActiveProjects(supabase: SupabaseClient) {
  return supabase.from('projects').select('id, name').eq('is_active', true).order('name');
}

export async function getAssignedActiveProjects(supabase: SupabaseClient, userId: string) {
  const { data: assignments, error } = await supabase
    .from('user_project_assignments')
    .select('project_id, projects(id, name, is_active)')
    .eq('user_id', userId);

  if (error) {
    return { data: null, error };
  }

  const projects = (assignments || [])
    .map((assignment: /* // */ any) => assignment.projects)
    .filter((project: /* // */ any) => project?.is_active)
    .map((project: /* // */ any) => ({ id: project.id, name: project.name }));

  return { data: projects, error: null };
}

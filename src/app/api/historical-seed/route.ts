import { NextResponse } from 'next/server';

// Historical seed endpoints are permanently disabled by policy
// (Appendix R, 2026-04-09). The pre-disable GET/DELETE handlers
// referenced tables that never existed in any migration
// (`project_expenses`, `shared_overhead_entries`) and reused Supabase
// query builders across `.select()` then `.delete()` — both removed in
// the F-16 cleanup. All HTTP verbs now return a uniform 405.

function disabled() {
  return NextResponse.json(
    {
      error: 'Historical seed endpoints are disabled by policy (Appendix R).',
      code: 'HISTORICAL_SEED_DISABLED',
    },
    { status: 405 },
  );
}

export const GET = disabled;
export const POST = disabled;
export const PUT = disabled;
export const PATCH = disabled;
export const DELETE = disabled;

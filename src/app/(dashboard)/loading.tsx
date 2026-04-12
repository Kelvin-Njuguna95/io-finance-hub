import { Skeleton } from '@/components/ui/skeleton';

export default function DashboardLoading() {
  return (
    <div className="p-6 space-y-6">
      {/* Hero card skeleton */}
      <div className="rounded-[var(--radius-hero)] bg-sidebar p-6 md:p-7">
        <Skeleton className="h-3 w-32 bg-white/10" />
        <Skeleton className="mt-2 h-6 w-40 bg-white/10" />
        <Skeleton className="mt-2 h-4 w-52 bg-white/10" />
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="rounded-xl bg-white/[0.04] p-4 ring-1 ring-inset ring-white/10"
            >
              <Skeleton className="h-2.5 w-20 bg-white/10" />
              <Skeleton className="mt-3 h-6 w-28 bg-white/10" />
              <Skeleton className="mt-2 h-3 w-24 bg-white/10" />
            </div>
          ))}
        </div>
      </div>

      {/* Stat cards skeleton */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-border bg-card p-4 shadow-elev-1"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-2">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-7 w-32" />
                <Skeleton className="h-3 w-28" />
              </div>
              <Skeleton className="size-10 rounded-xl" />
            </div>
          </div>
        ))}
      </div>

      {/* Section card skeleton */}
      <div className="rounded-xl border border-border bg-card shadow-elev-1">
        <div className="border-b border-border/70 px-5 py-4">
          <div className="flex items-center gap-3">
            <Skeleton className="size-9 rounded-xl" />
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-36" />
              <Skeleton className="h-3 w-52" />
            </div>
          </div>
        </div>
        <div className="p-4 space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}

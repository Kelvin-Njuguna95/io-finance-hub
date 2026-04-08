import { formatDate } from '@/lib/format';

interface HeroStat {
  label: string;
  value: string;
  subtitle?: string;
}

interface HeroCardProps {
  stats?: HeroStat[];
  children?: React.ReactNode;
}

export function HeroCard({ stats, children }: HeroCardProps) {
  const today = formatDate(new Date().toISOString());

  return (
    <div className="hero-card">
      <p className="text-[10px] uppercase tracking-[0.15em] text-white/40 font-medium">
        Impact Outsourcing
      </p>
      <h1 className="text-xl font-bold text-white mt-0.5">Finance Hub</h1>
      <p className="text-sm text-white/50 mt-0.5">{today}</p>

      {stats && stats.length > 0 && (
        <div className={`grid gap-4 mt-5 ${stats.length <= 3 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-2 sm:grid-cols-4'}`}>
          {stats.map((stat, i) => (
            <div key={i} className="bg-white/5 rounded-lg p-3 border border-white/10">
              <p className="text-[11px] uppercase tracking-wider text-white/40 font-medium">{stat.label}</p>
              <p className="text-lg font-bold text-white mt-1">{stat.value}</p>
              {stat.subtitle && <p className="text-[11px] text-white/40 mt-0.5">{stat.subtitle}</p>}
            </div>
          ))}
        </div>
      )}

      {children}
    </div>
  );
}

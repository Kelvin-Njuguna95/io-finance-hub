// kpi-app.jsx — KPI card grid with Tweaks panel

const { useState, useMemo } = React;

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "eyebrowFont": "mono",
  "showTotalRevenue": true,
  "totalRevenueVisual": "bars",
  "showShadow": false,
  "valueSize": 30,
  "cardHeight": 140,
  "cardRadius": 10,
  "cardPadding": 24,
  "stripCols": 4,
  "iconOpacity": 0.7,
  "showIcons": true,
  "trendStyle": "pill",
  "pageTone": "paper-2"
}/*EDITMODE-END*/;

// ──────── Icons (lucide monoline) ────────
const Icon = ({ name }) => {
  const props = {
    viewBox: "0 0 24 24", fill: "none", stroke: "currentColor",
    strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": true,
  };
  switch (name) {
    case "wallet":
      return (<svg {...props}>
        <path d="M19 7V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2"/>
        <path d="M3 5v14"/>
        <path d="M22 12h-5a2 2 0 1 0 0 4h5a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1z"/>
      </svg>);
    case "calendar":
      return (<svg {...props}>
        <rect x="3" y="4" width="18" height="18" rx="2"/>
        <path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>
      </svg>);
    case "dollar":
      return (<svg {...props}>
        <path d="M12 2v20"/>
        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
      </svg>);
    case "trending-up":
      return (<svg {...props}>
        <polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/>
        <polyline points="16 7 22 7 22 13"/>
      </svg>);
    case "arrow-up-right":
      return (<svg {...props}><path d="M7 17L17 7"/><path d="M9 7h8v8"/></svg>);
    case "arrow-down-right":
      return (<svg {...props}><path d="M17 7L7 17"/><path d="M15 17H7V9"/></svg>);
  }
};

// ──────── Right-side visuals ────────
const Sparkline = () => (
  <svg className="spark" viewBox="0 0 64 40" preserveAspectRatio="none">
    <path className="area" d="M2,30 L14,26 L24,28 L34,18 L46,14 L62,8 L62,40 L2,40 Z"/>
    <path className="line" d="M2,30 L14,26 L24,28 L34,18 L46,14 L62,8"/>
    <circle className="dot" cx="62" cy="8" r="2.5"/>
  </svg>
);

const Bars = () => (
  <div className="bars">
    {[14, 22, 18, 28, 24, 34, 38].map((h, i) => (
      <span key={i} style={{ height: h + "px" }}/>
    ))}
  </div>
);

const Ring = ({ pct = 78 }) => {
  const r = 20;
  const C = 2 * Math.PI * r;
  const filled = (pct / 100) * C;
  return (
    <div className="ring-wrap">
      <svg className="ring" viewBox="0 0 48 48">
        <circle className="track" cx="24" cy="24" r={r}/>
        <circle className="fill" cx="24" cy="24" r={r}
                strokeDasharray={`${filled} ${C - filled}`}/>
      </svg>
      <div className="ring-pct">{pct}%</div>
    </div>
  );
};

// ──────── Trend pill / inline ────────
const Trend = ({ direction, value, style }) => {
  if (style === "inline") {
    const color =
      direction === "up" ? "var(--success-soft-foreground)" :
      direction === "down" ? "var(--danger-soft-foreground)" :
      "var(--warm-grey-3)";
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 4,
        fontFamily: "var(--font-mono)", fontSize: 12, fontWeight: 500,
        color, fontVariantNumeric: "tabular-nums"
      }}>
        <Icon name={direction === "up" ? "arrow-up-right" : "arrow-down-right"}/>
        {value}
      </span>
    );
  }
  return (
    <span className={`trend ${direction}`}>
      <Icon name={direction === "up" ? "arrow-up-right" : "arrow-down-right"}/>
      {value}
    </span>
  );
};

// ──────── Card ────────
const KpiCard = ({ data, t }) => {
  const cardStyle = {
    height: t.cardHeight + "px",
    borderRadius: t.cardRadius + "px",
    padding: t.cardPadding + "px",
  };
  const valueStyle = { fontSize: t.valueSize + "px" };
  const iconStyle = { opacity: t.iconOpacity };

  return (
    <article
      className={`kpi ${t.eyebrowFont === "serif" ? "serif" : "mono"} ${t.showShadow ? "has-shadow" : ""}`}
      style={cardStyle}
    >
      <div className="kpi-top">
        <div className="eyebrow">{data.label}</div>
        {t.showIcons && (
          <span className="kpi-icon" style={iconStyle}>
            <Icon name={data.icon}/>
          </span>
        )}
      </div>

      <div className="kpi-bottom">
        <div>
          <div className="kpi-value-block">
            <div className="kpi-value" style={valueStyle}>
              {data.currency && <span className="kpi-currency">{data.currency}</span>}
              <span>{data.value}</span>
              {data.suffix && <span className="kpi-suffix">{data.suffix}</span>}
            </div>
          </div>
          <div className="kpi-compare">
            {data.trend && <Trend direction={data.trend} value={data.trendValue} style={t.trendStyle}/>}
            <span>{data.compare}</span>
          </div>
        </div>
        {data.visual && (
          <div className="kpi-visual">
            {data.visual === "spark" && <Sparkline/>}
            {data.visual === "bars" && <Bars/>}
            {data.visual === "ring" && <Ring pct={data.ringPct ?? 78}/>}
          </div>
        )}
      </div>
    </article>
  );
};

// ──────── Card data ────────
const TOTAL_REVENUE = (visualKind) => ({
  id: "total-revenue",
  label: "Total Revenue",
  currency: "KES",
  value: "12,408,500",
  trend: "up",
  trendValue: "8.7%",
  compare: "vs March 2026",
  icon: "trending-up",
  visual: visualKind, // "bars" | "spark"
});

const BANK_BALANCE = {
  id: "bank-balance",
  label: "Bank Balance",
  currency: "USD",
  value: "5,405",
  trend: "up",
  trendValue: "12.4%",
  compare: "vs March 2026",
  icon: "wallet",
  visual: "spark",
};

const APPROVED_BUDGET = {
  id: "approved-budget",
  label: "Approved Budget",
  currency: "KES",
  value: "2,847,000",
  trend: "down",
  trendValue: "3.1%",
  compare: "vs March 2026",
  icon: "calendar",
  visual: "ring",
  ringPct: 78,
};

const NET_PROFIT = {
  id: "net-profit",
  label: "Net Profit",
  currency: "KES",
  value: "1,221,000",
  trend: null,
  trendValue: null,
  compare: "Service period in progress",
  icon: "dollar",
  visual: null,
};

// ──────── App ────────
function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);

  const cards = useMemo(() => {
    const base = [BANK_BALANCE, APPROVED_BUDGET, NET_PROFIT];
    if (t.showTotalRevenue) {
      // Total Revenue leads — biggest, most important number on the dashboard
      return [TOTAL_REVENUE(t.totalRevenueVisual), ...base];
    }
    return base;
  }, [t.showTotalRevenue, t.totalRevenueVisual]);

  const stripStyle = { "--strip-cols": Math.min(t.stripCols, cards.length) };

  // Apply page tone
  React.useEffect(() => {
    const tone = t.pageTone === "paper-3" ? "var(--paper-3)"
               : t.pageTone === "paper"   ? "var(--paper)"
               : "var(--paper-2)";
    document.body.style.background = tone;
  }, [t.pageTone]);

  return (
    <div className="doc">
      <header className="doc-head">
        <div className="doc-eyebrow">Component · KPI card · v2</div>
        <h1 className="doc-title">KPI cards with a <em>Total Revenue</em> lead.</h1>
        <p className="doc-meta">
          Total Revenue is the headline KPI — it leads the strip. Open Tweaks
          (toolbar) to switch eyebrow voice, swap the right-side visual, adjust
          density, or hide cards. Trend pills stay semantic; gold stays on
          sparklines, bars, and the ring fill only.
        </p>
        <div className="surface-key">
          <div className="swatch-row"><span className="swatch s-page"></span><span className="swatch-label">PAGE · paper-2</span></div>
          <div className="swatch-row"><span className="swatch s-card"></span><span className="swatch-label">CARD · paper-1</span></div>
          <div className="swatch-row"><span className="swatch s-ink"></span><span className="swatch-label">INK · #111210</span></div>
          <div className="swatch-row"><span className="swatch s-gold"></span><span className="swatch-label">GOLD · #C8A24B</span></div>
        </div>
      </header>

      <section className="row-block">
        <div className="row-head">
          <div className="row-tag">Live preview · {t.eyebrowFont === "serif" ? "Fraunces serif eyebrow" : "Geist Mono eyebrow"}</div>
          <div className="row-desc">{cards.length} cards · {t.eyebrowFont === "serif"
            ? "Eyebrow inherits the system display family. Best when the ledger register leads."
            : "Eyebrow uses Geist Mono uppercase — matches the system's existing tile and table-header vocabulary."}
          </div>
        </div>
        <div className="strip" style={stripStyle}>
          {cards.map((c) => <KpiCard key={c.id} data={c} t={t}/>)}
        </div>
      </section>

      {/* Comparison row — both eyebrow voices side by side, fixed for reference */}
      <section className="row-block">
        <div className="row-head">
          <div className="row-tag">Reference · both voices, side by side</div>
          <div className="row-desc">Locked at 4 columns so the two eyebrow treatments can be compared on the same data.</div>
        </div>
        <div className="strip" style={{ "--strip-cols": 4, marginBottom: 12 }}>
          {[TOTAL_REVENUE("bars"), BANK_BALANCE, APPROVED_BUDGET, NET_PROFIT].map((c) => (
            <KpiCard key={"ref-serif-" + c.id} data={c} t={{ ...t, eyebrowFont: "serif" }}/>
          ))}
        </div>
        <div className="strip" style={{ "--strip-cols": 4 }}>
          {[TOTAL_REVENUE("bars"), BANK_BALANCE, APPROVED_BUDGET, NET_PROFIT].map((c) => (
            <KpiCard key={"ref-mono-" + c.id} data={c} t={{ ...t, eyebrowFont: "mono" }}/>
          ))}
        </div>
      </section>

      <footer className="notes">
        <div>
          <h4>What's new in v2</h4>
          <p><strong>Total Revenue</strong> joins as the lead card. KES 12,408,500 with a +8.7% trend and a small bar mini-chart in muted gold (toggle to sparkline in Tweaks).</p>
          <p>The strip now defaults to 4 columns to fit the new card alongside Bank Balance, Approved Budget, and Net Profit.</p>
        </div>
        <div>
          <h4>What stays reserved</h4>
          <p>Gold = brand identity, never trend semantics. Trend pills always green / red / neutral via system tokens. Icons remain quiet at 70% opacity. Cards stay flat with a hairline border by default — toggle <em className="gold-pin">card shadow</em> in Tweaks if you want to feel the lift.</p>
        </div>
      </footer>

      {/* TWEAKS PANEL */}
      <TweaksPanel title="Tweaks">
        <TweakSection label="Composition"/>
        <TweakToggle label="Show Total Revenue card" value={t.showTotalRevenue}
                     onChange={(v) => setTweak('showTotalRevenue', v)}/>
        <TweakRadio label="Total Revenue visual" value={t.totalRevenueVisual}
                    options={['bars', 'spark']}
                    onChange={(v) => setTweak('totalRevenueVisual', v)}/>
        <TweakSlider label="Strip columns" value={t.stripCols} min={2} max={5} step={1}
                     onChange={(v) => setTweak('stripCols', v)}/>

        <TweakSection label="Type"/>
        <TweakRadio label="Eyebrow font" value={t.eyebrowFont}
                    options={['mono', 'serif']}
                    onChange={(v) => setTweak('eyebrowFont', v)}/>
        <TweakSlider label="Value size" value={t.valueSize} min={22} max={42} step={1} unit="px"
                     onChange={(v) => setTweak('valueSize', v)}/>

        <TweakSection label="Geometry"/>
        <TweakSlider label="Card height" value={t.cardHeight} min={120} max={180} step={4} unit="px"
                     onChange={(v) => setTweak('cardHeight', v)}/>
        <TweakSlider label="Card radius" value={t.cardRadius} min={4} max={20} step={1} unit="px"
                     onChange={(v) => setTweak('cardRadius', v)}/>
        <TweakSlider label="Card padding" value={t.cardPadding} min={16} max={32} step={2} unit="px"
                     onChange={(v) => setTweak('cardPadding', v)}/>

        <TweakSection label="Surface & chrome"/>
        <TweakToggle label="Card shadow" value={t.showShadow}
                     onChange={(v) => setTweak('showShadow', v)}/>
        <TweakRadio label="Page tone" value={t.pageTone}
                    options={['paper', 'paper-2', 'paper-3']}
                    onChange={(v) => setTweak('pageTone', v)}/>
        <TweakToggle label="Show icons" value={t.showIcons}
                     onChange={(v) => setTweak('showIcons', v)}/>
        <TweakSlider label="Icon opacity" value={t.iconOpacity} min={0.3} max={1} step={0.05}
                     onChange={(v) => setTweak('iconOpacity', v)}/>

        <TweakSection label="Trend"/>
        <TweakRadio label="Trend style" value={t.trendStyle}
                    options={['pill', 'inline']}
                    onChange={(v) => setTweak('trendStyle', v)}/>
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App/>);

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { marked } from "marked";
import { api } from "./api.js";
import { useAuth } from "./authContext.jsx";
import { AuthScreen } from "./Auth.jsx";

marked.setOptions({ gfm: true, breaks: true });

// Theme context hook
function useTheme() {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('theme');
    return saved || 'dark';
  });

  useEffect(() => {
    localStorage.setItem('theme', theme);
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
      document.documentElement.setAttribute('data-theme', 'dark');
      document.body.classList.add('dark');
      document.body.classList.remove('light');
    } else {
      document.documentElement.classList.remove('dark');
      document.documentElement.classList.add('light');
      document.documentElement.setAttribute('data-theme', 'light');
      document.body.classList.remove('dark');
      document.body.classList.add('light');
    }
  }, [theme]);

  const toggleTheme = () => setTheme(t => t === 'light' ? 'dark' : 'light');
  return { theme, toggleTheme };
}

const fmt = (n, d = 0) => (n == null ? "—" : Number(n).toLocaleString(undefined, { maximumFractionDigits: d }));
const fmtFlower = (n) => {
  if (n == null) return "—";
  const num = Number(n);
  if (isNaN(num)) return "—";
  if (num === 0) return "0";
  if (num < 0.001) return num.toFixed(5);
  if (num < 0.01) return num.toFixed(4);
  if (num < 1) return num.toFixed(4);
  return num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 3 });
};
const fmtXp = (n) => {
  if (n == null) return "—";
  const num = Number(n);
  if (isNaN(num)) return "—";
  if (num % 1 === 0) return num.toLocaleString();
  return num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 });
};
const hrs = (m) => (m >= 1440 ? `${(m / 1440).toFixed(1)}d` : `${(m / 60).toFixed(1)}h`);
const md = (t) => marked.parse(String(t ?? "").trim() || "_⚠️ Empty response — check the server log._");

/* ─── Notion / Obsidian Tags & Badges ───────────────────────────────────────── */
const Tag = ({ color = "default", children }) => {
  const colors = {
    default: "bg-black/5 dark:bg-white/10 text-[#555] dark:text-[#aaa] border-transparent",
    gray: "bg-stone-500/10 text-stone-600 dark:text-stone-400 border-stone-500/20",
    brown: "bg-amber-800/10 text-amber-800 dark:text-amber-400 border-amber-800/20",
    amber: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30",
    yellow: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400 border-yellow-500/30",
    green: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30",
    blue: "bg-sky-500/15 text-sky-700 dark:text-sky-400 border-sky-500/30",
    purple: "bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/30",
    red: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/30",
  };
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium font-mono px-2 py-0.5 rounded border ${colors[color] || colors.default}`}>
      {children}
    </span>
  );
};

/* ─── Notion Property Row ──────────────────────────────────────────────────── */
function PropertyItem({ icon, label, value }) {
  return (
    <div className="flex items-center text-xs py-1 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] rounded px-1.5 transition-colors gap-2">
      <div className="w-24 md:w-36 shrink-0 flex items-center gap-1.5 text-[#787774] dark:text-[#8e8e8e] text-[11px] md:text-xs">
        <span className="text-xs opacity-80 shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className="flex-1 font-medium text-[#37352f] dark:text-[#d4d4d4] text-[11px] md:text-xs truncate" title={typeof value === "string" ? value : undefined}>
        {value}
      </div>
    </div>
  );
}

/* ─── Notion Callout Block ─────────────────────────────────────────────────── */
function Callout({ icon = "💡", type = "warning", title, children }) {
  const styles = {
    warning: "bg-amber-500/10 border-amber-500/30 text-amber-900 dark:text-amber-200",
    info: "bg-sky-500/10 border-sky-500/30 text-sky-900 dark:text-sky-200",
    success: "bg-emerald-500/10 border-emerald-500/30 text-emerald-900 dark:text-emerald-200",
    danger: "bg-rose-500/10 border-rose-500/30 text-rose-900 dark:text-rose-200",
  };
  return (
    <div className={`flex items-start gap-3 p-3.5 rounded-lg border text-[13px] leading-relaxed ${styles[type]}`}>
      <span className="text-base select-none shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        {title && <div className="font-semibold mb-0.5">{title}</div>}
        <div>{children}</div>
      </div>
    </div>
  );
}

/* ─── Notion Block Card ────────────────────────────────────────────────────── */
function BlockCard({ title, right, icon, children, className = "" }) {
  return (
    <div className={`bg-white dark:bg-[#202020] border border-black/10 dark:border-white/10 rounded-xl overflow-hidden shadow-sm hover:border-black/20 dark:hover:border-white/20 transition-all ${className}`}>
      {title && (
        <div className="px-3.5 md:px-4 py-2.5 bg-black/[0.02] dark:bg-white/[0.02] border-b border-black/5 dark:border-white/5 flex flex-wrap md:flex-nowrap gap-2 items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-semibold text-[#37352f] dark:text-[#e2e2e2]">
            {icon && <span className="opacity-80">{icon}</span>}
            <span>{title}</span>
          </div>
          {right}
        </div>
      )}
      <div className="p-3.5 md:p-4">{children}</div>
    </div>
  );
}

/* ─── Metric Stat Card ─────────────────────────────────────────────────────── */
function MetricStat({ label, value, sub, icon, trend }) {
  return (
    <div className="bg-white dark:bg-[#202020] border border-black/10 dark:border-white/10 rounded-xl p-3 md:p-4 hover:border-amber-500/40 dark:hover:border-amber-500/40 transition-all shadow-sm group">
      <div className="flex items-center justify-between text-[11px] md:text-xs text-[#787774] dark:text-[#8e8e8e] mb-1 md:mb-1.5">
        <span className="flex items-center gap-1 md:gap-1.5 font-medium truncate">
          <span className="text-sm transition-transform duration-200 group-hover:scale-110 shrink-0">{icon}</span>
          <span className="truncate">{label}</span>
        </span>
        {trend && <span className="font-mono text-[9px] md:text-[10px] text-emerald-600 dark:text-emerald-400 shrink-0">{trend}</span>}
      </div>
      <div className="text-xl md:text-2xl font-bold tracking-tight text-[#1a1a1a] dark:text-white font-display truncate">
        {value}
      </div>
      {sub && <div className="text-[10px] md:text-[11px] text-[#888] dark:text-[#777] mt-0.5 md:mt-1 font-mono truncate">{sub}</div>}
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════════════
   TAB 1: DASHBOARD
═════════════════════════════════════════════════════════════════════════════ */
function Dashboard({ farm, plan }) {
  if (!farm) return <div className="py-12 text-center text-sm text-[#888] animate-pulse">🌾 Accessing farm data from Sunflower Land...</div>;
  const pct = Math.min((farm.bumpkin.xp / farm.target.xp) * 100, 100).toFixed(1);

  return (
    <div className="space-y-6">
      {/* Top 4 Metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricStat icon="🧑‍🌾" label="Bumpkin Level" value={`Lv ${farm.bumpkin.level}`} sub="Active Explorer" />
        <MetricStat icon="⭐" label="Experience Points" value={fmt(farm.bumpkin.xp)} sub={`${fmt(farm.target.remaining)} to Lv 100`} />
        <MetricStat icon="🌸" label="FLOWER" value={Number(farm.currencies.flowerApprox).toFixed(2)} sub="approx treasury" />
        <MetricStat icon="🪙" label="Gold Coins" value={fmt(farm.currencies.coins)} sub="available" />
      </div>

      {/* Road to Level 100 Progress Card */}
      <BlockCard
        icon="🎯"
        title="Road to Level 100 Milestone"
        right={<Tag color="amber">{pct}% Complete · {fmt(farm.target.remaining)} XP left</Tag>}
      >
        <div className="space-y-3">
          <div className="w-full bg-black/5 dark:bg-black/40 h-3 rounded-full overflow-hidden p-0.5 border border-black/10 dark:border-white/10">
            <div
              className="bg-gradient-to-r from-amber-500 to-yellow-400 h-full rounded-full transition-all duration-500 shadow-sm"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-[#787774] dark:text-[#888] font-mono">
            <span>Level {farm.bumpkin.level} ({fmt(farm.bumpkin.xp)} XP)</span>
            <span>Target: Level 100 ({fmt(farm.target.xp)} XP)</span>
          </div>
        </div>
      </BlockCard>

      {/* Plan Alert if Unaffordable */}
      {plan && !plan.affordable && (
        <Callout icon="⚠️" type="warning" title="Resource Deficit Warning">
          {plan.notes.join(" ")}
        </Callout>
      )}

      {/* Cooking Pipeline Recipes */}
      {plan && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#787774] dark:text-[#888] flex items-center gap-1.5">
              <span>🍳</span> Optimal Cooking Strategy by Building
            </h3>
            <span className="text-xs text-[#888] font-mono">{plan.buildings.length} nodes active</span>
          </div>

          <div className="grid md:grid-cols-2 gap-3">
            {plan.buildings.map((b) => (
              <div
                key={b.building}
                className="bg-white dark:bg-[#202020] border border-black/10 dark:border-white/10 rounded-xl p-4 hover:border-white/25 transition-all shadow-sm flex flex-col justify-between"
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-[#888] font-mono">🏠 {b.building}</span>
                    {b.verified ? <Tag color="green">verified</Tag> : <Tag color="gray">unverified</Tag>}
                  </div>
                  <div className="text-base font-bold text-[#1a1a1a] dark:text-white font-display">
                    {b.recipe}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 mt-4 pt-3 border-t border-black/5 dark:border-white/5 text-center text-xs font-mono">
                  <div className="bg-black/[0.03] dark:bg-white/[0.04] p-1.5 rounded-lg">
                    <div className="text-[10px] text-[#888]">XP BATCH</div>
                    <div className="font-semibold text-emerald-600 dark:text-emerald-400">+{fmtXp(b.batchXp)}</div>
                  </div>
                  <div className="bg-black/[0.03] dark:bg-white/[0.04] p-1.5 rounded-lg">
                    <div className="text-[10px] text-[#888]">FLOWER</div>
                    <div className="font-semibold text-amber-600 dark:text-amber-400">🌸 {fmtFlower(b.flowerCost)}</div>
                  </div>
                  <div className="bg-black/[0.03] dark:bg-white/[0.04] p-1.5 rounded-lg">
                    <div className="text-[10px] text-[#888]">COOK TIME</div>
                    <div className="font-semibold text-[#555] dark:text-[#aaa]">⏱ {hrs(b.totalMinutes)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════════════
   TAB 2: PLANNER
═════════════════════════════════════════════════════════════════════════════ */
function Planner({ plan }) {
  if (!plan) return <div className="py-12 text-center text-sm text-[#888] animate-pulse">🗺️ Calculating optimal farming route...</div>;
  if (plan.error) return <Callout icon="❌" type="danger" title="Optimization Error">{plan.error}</Callout>;

  return (
    <div className="space-y-6">
      {/* Notion Database Table View */}
      <BlockCard
        icon="📋"
        title="Recipe Optimization Comparison"
        right={<Tag color="blue">Best XP/FLOWER Efficiency</Tag>}
      >
        <div className="overflow-x-auto -mx-4 -mb-4">
          <table className="notion-table">
            <thead>
              <tr>
                <th>Building</th>
                <th>Recommended Recipe</th>
                <th>XP / Batch</th>
                <th>FLOWER Cost</th>
                <th>XP / FLOWER</th>
                <th>XP / Hour</th>
                <th>Duration</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {plan.buildings.map((b) => (
                <tr key={b.building}>
                  <td className="font-medium">{b.building}</td>
                  <td className="font-semibold text-amber-600 dark:text-amber-400">{b.recipe}</td>
                  <td className="font-mono text-emerald-600 dark:text-emerald-400">+{fmtXp(b.batchXp)}</td>
                  <td className="font-mono">🌸 {fmtFlower(b.flowerCost)}</td>
                  <td className="font-mono font-semibold">{isFinite(b.xpPerFlower) && b.xpPerFlower > 0 ? fmt(b.xpPerFlower) : "—"}</td>
                  <td className="font-mono">{fmt(b.xpPerHour)}</td>
                  <td className="font-mono text-[#888]">{hrs(b.totalMinutes)}</td>
                  <td>{b.verified ? <Tag color="green">verified</Tag> : <Tag color="gray">check</Tag>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </BlockCard>

      {/* Actionable Today's Blueprint */}
      <BlockCard icon="📅" title="Today's Farm Action Plan">
        <div className="space-y-4 text-xs">
          <div className="p-3 bg-black/[0.02] dark:bg-white/[0.02] rounded-lg border border-black/5 dark:border-white/5 space-y-2">
            <div className="flex items-start gap-2">
              <span className="text-sm">🌾</span>
              <div>
                <strong className="text-[#1a1a1a] dark:text-white">Crops to Farm & Harvest:</strong>
                <span className="text-[#666] dark:text-[#aaa] ml-1.5 font-mono">{plan.farm.join(", ") || "—"}</span>
              </div>
            </div>
            <div className="flex items-start gap-2 pt-2 border-t border-black/5 dark:border-white/5">
              <span className="text-sm">🛒</span>
              <div>
                <strong className="text-[#1a1a1a] dark:text-white">Procure / Buy from Market:</strong>
                <span className="text-[#666] dark:text-[#aaa] ml-1.5 font-mono">{plan.buy.join(", ") || "—"}</span>
              </div>
            </div>
            {plan.estimate && (
              <div className="flex items-start gap-2 pt-2 border-t border-black/5 dark:border-white/5 font-mono">
                <span className="text-sm">🎯</span>
                <div>
                  <strong className="text-[#1a1a1a] dark:text-white">Milestone Estimate:</strong>
                  <span className="text-amber-600 dark:text-amber-400 ml-1.5">
                    ~{fmt(plan.estimate.batchesNeeded)} × {plan.estimate.recipe} ≈ {fmt(plan.estimate.estimatedFlower)} FLOWER
                  </span>
                </div>
              </div>
            )}
          </div>

          {plan.notes.map((n, i) => (
            <Callout key={i} icon="💡" type="warning">
              {n}
            </Callout>
          ))}
        </div>
      </BlockCard>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════════════
   TAB 3: MARKET
═════════════════════════════════════════════════════════════════════════════ */
function Market({ farm, market }) {
  const [sort, setSort] = useState("value");
  const [filterOwnedOnly, setFilterOwnedOnly] = useState(false);

  const rows = useMemo(() => {
    if (!farm || !market) return [];
    return Object.entries(market.prices)
      .map(([item, price]) => {
        const qty = farm.inventory[item] ?? 0;
        return { item, price, qty, value: qty * price };
      })
      .filter((r) => !filterOwnedOnly || r.qty > 0)
      .sort((a, b) => (sort === "value" ? b.value - a.value : sort === "price" ? b.price - a.price : a.item.localeCompare(b.item)));
  }, [farm, market, sort, filterOwnedOnly]);

  if (!farm || !market) return <div className="py-12 text-center text-sm text-[#888] animate-pulse">💰 Fetching real-time market orderbooks...</div>;
  const total = rows.reduce((s, r) => s + r.value, 0);

  return (
    <div className="space-y-6">
      {/* Market Header Bar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 bg-white dark:bg-[#202020] p-3.5 md:p-4 rounded-xl border border-black/10 dark:border-white/10 shadow-sm">
        <div>
          <div className="text-xs text-[#888] font-mono uppercase">Total Inventory Valuation</div>
          <div className="text-xl md:text-2xl font-bold font-display text-[#1a1a1a] dark:text-white flex items-center gap-2">
            <span>🌸 {total.toFixed(2)}</span>
            <span className="text-xs font-mono font-normal text-amber-500">FLOWER VALUE</span>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto">
          <button
            onClick={() => setFilterOwnedOnly(!filterOwnedOnly)}
            className={`flex-1 md:flex-none whitespace-nowrap px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${filterOwnedOnly ? 'bg-amber-500/20 border-amber-500/40 text-amber-300' : 'bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 text-[#888]'}`}
          >
            {filterOwnedOnly ? '✓ In Stock Only' : 'Show All Items'}
          </button>
          <div className="flex-1 md:flex-none">
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="w-full bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 rounded-lg px-3 py-1.5 text-xs text-[#37352f] dark:text-white outline-none cursor-pointer"
            >
              <option value="value">Sort: Total Value (High → Low)</option>
              <option value="price">Sort: Unit Price</option>
              <option value="name">Sort: Name (A-Z)</option>
            </select>
          </div>
        </div>
      </div>

      {/* Notion Grid Cards */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {rows.map((r) => (
          <div
            key={r.item}
            className={`bg-white dark:bg-[#202020] border rounded-xl p-3.5 transition-all shadow-sm ${r.qty > 0 ? "border-black/10 dark:border-white/10 hover:border-white/25" : "border-black/5 dark:border-white/5 opacity-50"}`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-semibold text-[#1a1a1a] dark:text-white truncate">{r.item}</span>
              {r.qty > 0 && r.value >= 0.1 ? <Tag color="green">trade ready</Tag> : r.qty > 0 ? <Tag color="gray">owned</Tag> : null}
            </div>

            <div className="grid grid-cols-3 gap-1.5 mt-3 text-center font-mono">
              <div className="bg-black/[0.03] dark:bg-white/[0.04] p-1.5 rounded-lg">
                <div className="text-[9px] text-[#888]">QTY</div>
                <div className="text-xs font-semibold text-[#1a1a1a] dark:text-white">{fmt(r.qty, 2)}</div>
              </div>
              <div className="bg-black/[0.03] dark:bg-white/[0.04] p-1.5 rounded-lg">
                <div className="text-[9px] text-[#888]">UNIT</div>
                <div className="text-xs font-semibold text-[#888]">{r.price}</div>
              </div>
              <div className="bg-black/[0.03] dark:bg-white/[0.04] p-1.5 rounded-lg">
                <div className="text-[9px] text-[#888]">VALUE</div>
                <div className="text-xs font-bold text-amber-500">🌸 {r.value.toFixed(2)}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════════════
   TAB 4: ACTIVITY
═════════════════════════════════════════════════════════════════════════════ */
function Activity() {
  const [a, setA] = useState(null);
  useEffect(() => { api.activity().then(setA); }, []);

  if (!a) return <div className="py-12 text-center text-sm text-[#888] animate-pulse">📊 Analyzing snapshot differences...</div>;
  if (a.error || a.note) {
    return (
      <Callout icon="📊" type="info" title="Snapshot History Pending">
        {a.note ?? a.error} Activity compares your two most recent snapshots. Play Sunflower Land and refresh the farm to generate delta reports.
      </Callout>
    );
  }

  const obs = Object.entries(a.observed ?? {}).sort(([, x], [, y]) => Math.abs(y) - Math.abs(x));
  const inf = Object.entries(a.inferred ?? {}).sort(([, x], [, y]) => Math.abs(y) - Math.abs(x));
  const Delta = ({ v }) => (
    <span className={`font-mono font-semibold ${v > 0 ? "text-emerald-500" : "text-rose-400"}`}>
      {v > 0 ? "+" : ""}{fmt(v, 2)}
    </span>
  );

  return (
    <div className="space-y-6">
      <div className="grid sm:grid-cols-2 gap-3">
        <MetricStat icon="⭐" label="XP Delta" value={`+${fmt(a.xpDelta)}`} sub="between last two snapshots" trend="Live Delta" />
        <MetricStat icon="🕒" label="Observation Window" value={a.from && a.to ? `${((a.to - a.from) / 3600000).toFixed(1)}h` : "—"} sub={a.to ? new Date(a.to).toLocaleString() : ""} />
      </div>

      <BlockCard icon="⚡" title="Observed Event Counters" right={<Tag color="green">exact · farmActivity</Tag>}>
        {obs.length === 0 ? (
          <p className="text-xs text-[#888] font-mono">No counter changes detected in this window.</p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs font-mono">
            {obs.map(([k, v]) => (
              <div key={k} className="flex justify-between py-1.5 border-b border-black/5 dark:border-white/5">
                <span className="text-[#787774] dark:text-[#aaa] truncate">{k}</span>
                <Delta v={v} />
              </div>
            ))}
          </div>
        )}
      </BlockCard>

      <BlockCard icon="📦" title="Inferred Inventory Fluctuations" right={<Tag color="gray">inferred · cross-check</Tag>}>
        {inf.length === 0 ? (
          <p className="text-xs text-[#888] font-mono">No net inventory movements recorded.</p>
        ) : (
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs font-mono">
            {inf.map(([k, v]) => (
              <div key={k} className="flex justify-between py-1.5 border-b border-black/5 dark:border-white/5">
                <span className="text-[#787774] dark:text-[#aaa] truncate">{k}</span>
                <Delta v={v} />
              </div>
            ))}
          </div>
        )}
      </BlockCard>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════════════
   TAB 5 (NEW): RECIPES — All building recipes with live farm data
═════════════════════════════════════════════════════════════════════════════ */
const BUILDING_ICONS = {
  "Fire Pit": "🔥",
  "Kitchen": "🍳",
  "Deli": "🧀",
  "Smoothie Shack": "🥤",
  "Bakery": "🎂",
};

function fmtTime(minutes) {
  if (!minutes || minutes === 0) return "Instant";
  if (minutes < 1) return `${Math.round(minutes * 60)}s`;
  if (minutes < 60) {
    const m = Math.floor(minutes);
    const s = Math.round((minutes - m) * 60);
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  if (minutes < 1440) {
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  const d = Math.floor(minutes / 1440);
  const h = Math.round((minutes % 1440) / 60);
  return h > 0 ? `${d}d ${h}h` : `${d}d`;
}

function RecipeCard({ r }) {
  const [expanded, setExpanded] = useState(false);
  const ready = r.canCook;
  const hasCooked = r.alreadyCooked > 0;
  const missingEntries = Object.entries(r.missingIngredients ?? {});

  const hasXpBoost = r.effectiveXp != null && r.baseXp != null && Math.abs(r.effectiveXp - r.baseXp) > 0.001;
  const hasTimeBoost = r.effectiveCookMinutes != null && r.baseCookMinutes != null && Math.abs(r.effectiveCookMinutes - r.baseCookMinutes) > 0.01;

  return (
    <div
      onClick={() => setExpanded((x) => !x)}
      className={`rounded-xl border transition-all cursor-pointer select-none ${ready
        ? "border-emerald-500/30 bg-emerald-500/5 hover:border-emerald-500/50 dark:bg-emerald-500/5"
        : "border-black/10 dark:border-white/[0.07] bg-white dark:bg-[#1e1e1e] hover:border-black/20 dark:hover:border-white/15"
        }`}
    >
      {/* Card Header */}
      <div className="p-3.5">
        <div className="flex items-start justify-between gap-2 mb-2.5">
          <div className="min-w-0">
            <div className="font-semibold text-[13px] text-[#1a1a1a] dark:text-white truncate leading-tight flex items-center gap-1.5 flex-wrap">
              <span>{r.name}</span>
              {r.effectiveOutput > 1 && (
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-purple-500/15 border border-purple-500/30 text-purple-700 dark:text-purple-300 font-semibold">
                  ×{r.effectiveOutput} food
                </span>
              )}
            </div>
            {r.isIntermediate && (
              <span className="text-[10px] font-mono text-[#888] mt-0.5 inline-block">intermediate · also an ingredient</span>
            )}
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {hasCooked && (
              <span className="inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded bg-sky-500/15 border border-sky-500/30 text-sky-700 dark:text-sky-300">
                🍽 ×{r.alreadyCooked}
              </span>
            )}
            {ready
              ? <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded border bg-emerald-500/20 border-emerald-500/40 text-emerald-700 dark:text-emerald-400">✓ Ready</span>
              : <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded border bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 text-[#888]">Missing</span>
            }
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-4 gap-1.5 text-center font-mono">
          <div className="bg-black/[0.04] dark:bg-white/[0.04] p-1.5 rounded-lg flex flex-col justify-center min-h-[48px]">
            <div className="text-[9px] text-[#888] uppercase">XP</div>
            <div className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 leading-tight">
              +{fmtXp(r.effectiveXp ?? r.baseXp)}
            </div>
            {hasXpBoost && (
              <div className="text-[9px] text-[#888] line-through leading-none mt-0.5">
                +{fmtXp(r.baseXp)}
              </div>
            )}
            {r.effectiveOutput > 1 && (
              <div className="text-[8px] text-emerald-600/75 dark:text-emerald-400/75 leading-none mt-0.5">
                ({fmtXp(r.batchXp)} batch)
              </div>
            )}
          </div>
          <div className="bg-black/[0.04] dark:bg-white/[0.04] p-1.5 rounded-lg flex flex-col justify-center min-h-[48px]">
            <div className="text-[9px] text-[#888] uppercase">Time</div>
            <div className="text-[11px] font-bold text-[#555] dark:text-[#ccc] leading-tight">
              {fmtTime(r.effectiveCookMinutes ?? r.baseCookMinutes)}
            </div>
            {hasTimeBoost && (
              <div className="text-[9px] text-[#888] line-through leading-none mt-0.5">
                {fmtTime(r.baseCookMinutes)}
              </div>
            )}
          </div>
          <div className="bg-black/[0.04] dark:bg-white/[0.04] p-1.5 rounded-lg flex flex-col justify-center min-h-[48px]">
            <div className="text-[9px] text-[#888] uppercase">🌸 Value</div>
            <div className="text-[11px] font-bold text-amber-600 dark:text-amber-400 leading-tight">
              {fmtFlower(r.flowerCost)}
            </div>
            {r.flowerToBuy > 0 ? (
              <div className="text-[8px] text-rose-500 dark:text-rose-400 font-mono leading-none mt-0.5" title="FLOWER required to buy missing ingredients">
                buy {fmtFlower(r.flowerToBuy)}
              </div>
            ) : (
              <div className="text-[8px] text-emerald-600/75 dark:text-emerald-400/75 font-mono leading-none mt-0.5" title="All ingredients owned in inventory">
                in bag
              </div>
            )}
          </div>
          <div className="bg-black/[0.04] dark:bg-white/[0.04] p-1.5 rounded-lg flex flex-col justify-center min-h-[48px]">
            <div className="text-[9px] text-[#888] uppercase">Gems</div>
            <div className="text-[11px] font-bold text-purple-600 dark:text-purple-400 leading-tight">💎 {r.instantGems}</div>
          </div>
        </div>

        {/* Missing ingredient pills (always visible if not ready) */}
        {!ready && missingEntries.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1">
            {missingEntries.slice(0, 4).map(([ing, d]) => (
              <span key={ing} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-400">
                {ing} {d.have}/{d.need}
              </span>
            ))}
            {missingEntries.length > 4 && (
              <span className="text-[10px] font-mono text-[#888]">+{missingEntries.length - 4} more…</span>
            )}
          </div>
        )}
      </div>

      {/* Expanded Detail Panel */}
      {expanded && (
        <div className="border-t border-black/5 dark:border-white/5 px-3.5 pb-3.5 pt-3 space-y-3" onClick={(e) => e.stopPropagation()}>
          {/* All Ingredients — effective (skill-adjusted) quantities */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[10px] font-mono font-semibold uppercase text-[#888]">Ingredients</div>
              {r.ingredientMultiplier && r.ingredientMultiplier !== 1 && (
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400">
                  ×{r.ingredientMultiplier} (skill)
                </span>
              )}
            </div>
            <div className="space-y-1">
              {Object.entries(r.effectiveIngredients ?? r.ingredients).map(([ing, qty]) => {
                const missing = r.missingIngredients?.[ing];
                const have = missing ? missing.have : Number(qty);
                const need = Number(qty);
                const ok = have >= need;
                const baseQty = r.ingredients?.[ing];
                const modified = baseQty !== undefined && baseQty !== need;
                return (
                  <div key={ing} className="flex items-center justify-between text-xs">
                    <span className="text-[#555] dark:text-[#bbb] flex items-center gap-1">
                      {ing}
                      {modified && (
                        <span className="text-[9px] font-mono text-amber-500 opacity-70">(base {baseQty})</span>
                      )}
                    </span>
                    <span className={`font-mono font-semibold ${ok ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                      }`}>
                      {ok ? `✓ ${need}` : `${have} / ${need}`}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Skills Applied & Boost Breakdown */}
          {(r.boostBreakdown?.length > 0 || r.skillsApplied?.length > 0) && (
            <div>
              <div className="text-[10px] font-mono font-semibold uppercase text-[#888] mb-1">Skills & Buffs Active</div>
              <div className="flex flex-wrap gap-1">
                {(r.boostBreakdown?.length > 0 ? r.boostBreakdown : r.skillsApplied.map(s => ({ skill: s, label: s }))).map((b, idx) => (
                  <span key={idx} className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${b.skill === "VIP Access"
                    ? "bg-amber-500/15 border border-amber-500/30 text-amber-700 dark:text-amber-400 font-semibold"
                    : "bg-purple-500/10 border border-purple-500/20 text-purple-700 dark:text-purple-400"
                    }`}>
                    {b.skill === "VIP Access" ? "⭐ " : ""}{b.skill} {b.label && b.label !== b.skill ? `(${b.label})` : ""}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Must Produce / Buy */}
          {Object.keys(r.mustProduce ?? {}).length > 0 && (
            <div>
              <div className="text-[10px] font-mono font-semibold uppercase text-[#888] mb-1">Must Produce (Untradable)</div>
              <div className="flex flex-wrap gap-1">
                {Object.entries(r.mustProduce).map(([k, v]) => (
                  <span key={k} className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 font-mono">{k} ×{v}</span>
                ))}
              </div>
            </div>
          )}
          {Object.keys(r.buy ?? {}).length > 0 && (
            <div>
              <div className="text-[10px] font-mono font-semibold uppercase text-[#888] mb-1 flex items-center justify-between">
                <span>Can Buy from Market</span>
                {r.flowerToBuy > 0 && (
                  <span className="text-amber-600 dark:text-amber-400 font-mono">🌸 ~{fmtFlower(r.flowerToBuy)} needed</span>
                )}
              </div>
              <div className="flex flex-wrap gap-1">
                {Object.entries(r.buy).map(([k, v]) => (
                  <span key={k} className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/10 border border-sky-500/20 text-sky-700 dark:text-sky-400 font-mono">{k} ×{v}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Recipes({ recipesData }) {
  const [filter, setFilter] = useState("all"); // all | ready | missing
  const [activeBuilding, setActiveBuilding] = useState(null);

  if (!recipesData) return (
    <div className="py-12 text-center text-sm text-[#888] animate-pulse">🍳 Loading recipe catalogue with farm data...</div>
  );
  if (recipesData.error) return <Callout icon="❌" type="danger" title="Recipe Error">{recipesData.error}</Callout>;

  const buildings = Object.keys(recipesData.byBuilding ?? {});
  const activeBld = activeBuilding ?? buildings[0];
  const allForBuilding = recipesData.byBuilding?.[activeBld] ?? [];

  const filtered = allForBuilding.filter((r) => {
    if (filter === "ready") return r.canCook;
    if (filter === "missing") return !r.canCook;
    return true;
  });

  const readyCount = allForBuilding.filter((r) => r.canCook).length;
  const totalCount = allForBuilding.length;

  return (
    <div className="space-y-5">
      {/* Header Summary Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-[#202020] p-4 rounded-xl border border-black/10 dark:border-white/10 shadow-sm">
        <div>
          <div className="text-xs text-[#888] font-mono uppercase">Cooking Catalogue</div>
          <div className="text-xl font-bold font-display text-[#1a1a1a] dark:text-white flex items-center gap-2 mt-0.5">
            <span>{recipesData.totalRecipes} Recipes</span>
            <span className="text-xs font-mono font-normal text-emerald-500">{recipesData.activeBuildings?.length} Buildings Active</span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto no-scrollbar pb-0.5">
          {["all", "ready", "missing"].map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors capitalize ${filter === f
                ? f === "ready"
                  ? "bg-emerald-500/20 border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
                  : f === "missing"
                    ? "bg-rose-500/15 border-rose-500/30 text-rose-700 dark:text-rose-400"
                    : "bg-amber-500/20 border-amber-500/40 text-amber-700 dark:text-amber-300"
                : "bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 text-[#888]"
                }`}
            >
              {f === "all" ? `All (${totalCount})` : f === "ready" ? `✓ Ready (${readyCount})` : `Missing (${totalCount - readyCount})`}
            </button>
          ))}
        </div>
      </div>

      {/* Building Tabs */}
      <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
        {buildings.map((bld) => {
          const bldRecipes = recipesData.byBuilding[bld] ?? [];
          const bldReady = bldRecipes.filter((r) => r.canCook).length;
          return (
            <button
              key={bld}
              onClick={() => setActiveBuilding(bld)}
              className={`shrink-0 flex items-center gap-1.5 sm:gap-2 px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-xl text-xs font-medium border transition-all whitespace-nowrap ${activeBld === bld
                ? "bg-amber-500/20 border-amber-500/40 text-amber-700 dark:text-amber-300 font-semibold"
                : "bg-white dark:bg-[#202020] border-black/10 dark:border-white/10 text-[#787774] dark:text-[#999] hover:border-amber-500/30"
                }`}
            >
              <span>{BUILDING_ICONS[bld] ?? "🏠"}</span>
              <span>{bld}</span>
              {bldReady > 0 && (
                <span className="font-mono text-[10px] bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded-full">{bldReady}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Building Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[#787774] dark:text-[#888] flex items-center gap-2">
          <span className="text-base">{BUILDING_ICONS[activeBld] ?? "🏠"}</span>
          {activeBld}
        </h3>
        <span className="text-[11px] font-mono text-[#888]">
          {readyCount}/{totalCount} ready to cook
        </span>
      </div>

      {/* Recipe Grid */}
      {filtered.length === 0 ? (
        <div className="py-10 text-center">
          <div className="text-2xl mb-2">{filter === "ready" ? "🧑‍🍳" : "📦"}</div>
          <p className="text-sm text-[#888] font-mono">
            {filter === "ready" ? "No recipes ready to cook right now." : "All recipes are ready!"}
          </p>
          <button onClick={() => setFilter("all")} className="mt-2 text-xs text-amber-500 hover:underline">Show all recipes</button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((r) => <RecipeCard key={r.name} r={r} />)}
        </div>
      )}
    </div>
  );
}


function Quests({ farm }) {
  if (!farm) return <div className="py-12 text-center text-sm text-[#888] animate-pulse">📜 Loading chores and deliveries...</div>;

  const reward = (r = {}) => [
    r.coins ? `🪙 ${fmt(r.coins)}` : null,
    r.sfl ? `🌸 ${r.sfl}` : null,
    ...Object.entries(r.items ?? {}).map(([k, v]) => `${v}× ${k}`),
  ].filter(Boolean).join(" · ") || "—";

  const chores = Object.entries(farm.chores ?? {});
  const deliveries = farm.deliveries ?? [];
  const doneBounties = new Set((farm.bounties?.completed ?? []).map((c) => c.id));
  const bounties = (farm.bounties?.requests ?? []).filter((b) => b.name === "Chicken" || b.name === "Cow" || b.name === "Sheep" || (b.items && Object.keys(b.items)[0] === "Shiny Feather"));

  return (
    <div className="space-y-6">
      {/* Chore Board */}
      <BlockCard
        icon="📋"
        title="NPC Chore Board"
        right={<Tag color="amber">{chores.filter(([, c]) => c.completedAt).length} of {chores.length} Complete</Tag>}
      >
        <div className="grid md:grid-cols-2 gap-3">
          {chores.map(([npc, c]) => (
            <div
              key={npc}
              className={`p-3.5 rounded-xl border transition-all ${c.completedAt ? "bg-emerald-500/5 border-emerald-500/20" : "bg-black/[0.02] dark:bg-white/[0.02] border-black/10 dark:border-white/10"}`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold capitalize text-[#1a1a1a] dark:text-white flex items-center gap-1.5">
                  <span>🧑‍🌾</span> {npc}
                </span>
                {c.completedAt ? <Tag color="green">completed</Tag> : <Tag color="gray">pending</Tag>}
              </div>
              <div className="text-xs text-[#787774] dark:text-[#aaa] mb-2">{c.name}</div>
              <div className="text-[11px] font-mono text-amber-600 dark:text-amber-400 bg-black/[0.02] dark:bg-white/[0.03] px-2 py-1 rounded">
                Reward: {reward(c.reward)}
              </div>
            </div>
          ))}
        </div>
      </BlockCard>

      {/* Deliveries */}
      <BlockCard
        icon="🚚"
        title="Deliveries Pipeline"
        right={<Tag color="blue">{deliveries.filter((d) => d.completedAt).length} of {deliveries.length} Fulfilled</Tag>}
      >
        <div className="space-y-2">
          {deliveries.map((d) => (
            <div
              key={d.id}
              className={`flex flex-col sm:flex-row sm:items-center justify-between p-3 rounded-xl border text-xs gap-2 ${d.completedAt ? "bg-emerald-500/5 border-emerald-500/20" : "bg-black/[0.02] dark:bg-white/[0.02] border-black/10 dark:border-white/10"}`}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold capitalize text-[#1a1a1a] dark:text-white">{d.from}</span>
                <span className="text-[#888] font-mono text-[11px]">→ {Object.entries(d.items).map(([k, v]) => `${fmt(v)}× ${k}`).join(", ")}</span>
              </div>
              <div className="flex items-center justify-between sm:justify-end gap-2 shrink-0">
                <span className="font-mono text-[11px] text-[#888]">{reward(d.reward)}</span>
                {d.completedAt ? <Tag color="green">done</Tag> : <Tag color="gray">open</Tag>}
              </div>
            </div>
          ))}
        </div>
      </BlockCard>

      {/* Bounties */}
      <BlockCard
        icon="🎯"
        title="Animal & Feather Bounties"
        right={<Tag color="purple">{doneBounties.size} Claimed</Tag>}
      >
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {bounties.map((b) => (
            <div
              key={b.id}
              className={`p-3.5 rounded-xl border text-xs ${doneBounties.has(b.id) ? "bg-emerald-500/5 border-emerald-500/20" : "bg-black/[0.02] dark:bg-white/[0.02] border-black/10 dark:border-white/10"}`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold text-[#1a1a1a] dark:text-white">{b.name}{b.level ? ` · Lv ${b.level}` : ""}</span>
                {doneBounties.has(b.id) ? <Tag color="green">claimed</Tag> : <Tag color="gray">open</Tag>}
              </div>
              <div className="text-[11px] font-mono text-amber-500 mt-1">Reward: {reward(b)}</div>
            </div>
          ))}
        </div>
      </BlockCard>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════════════
   TAB 6: HISTORY (VAULT CHAT SESSIONS)
═════════════════════════════════════════════════════════════════════════════ */
function History({ onResume }) {
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [active, setActive] = useState(null);
  const [loadingActive, setLoadingActive] = useState(false);

  const loadSessions = () => {
    setLoading(true);
    setError(null);
    api.sessions()
      .then((res) => {
        const list = Array.isArray(res) ? res : (res?.sessions ?? []);
        setSessions(list);
      })
      .catch((err) => {
        console.error("Failed to load sessions:", err);
        setError("Failed to fetch session history from database.");
        setSessions([]);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadSessions(); }, []);

  const openSession = async (sessionId) => {
    setLoadingActive(true);
    try {
      const res = await api.session(sessionId);
      const msgs = Array.isArray(res) ? res : (res?.messages ?? []);
      setActive({ id: sessionId, msgs });
    } catch (err) {
      console.error("Failed to load session msgs:", err);
    } finally {
      setLoadingActive(false);
    }
  };

  if (loading && sessions.length === 0) {
    return <div className="py-12 text-center text-sm text-[#888] animate-pulse font-mono">🗂️ Accessing conversation vault...</div>;
  }

  if (error) {
    return <Callout icon="⚠️" type="danger" title="Database Error">{error}</Callout>;
  }

  if (active) {
    const msgList = Array.isArray(active.msgs) ? active.msgs : (active.msgs?.messages ?? []);
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <button
            onClick={() => setActive(null)}
            className="flex items-center gap-1.5 text-xs font-mono text-[#888] hover:text-[#1a1a1a] dark:hover:text-white transition-colors"
          >
            ← Back to All Vault Sessions
          </button>
          <button
            onClick={() => onResume(active.id, msgList)}
            className="flex items-center gap-1.5 text-xs font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 px-3 py-1.5 rounded-lg transition-colors shadow-sm"
          >
            ↩ Resume in Antigravity Assistant
          </button>
        </div>

        <BlockCard
          icon="💬"
          title={`Session Log · ${new Date(Number(msgList[0]?.created_at) || Date.now()).toLocaleString()}`}
          right={<Tag color="blue">{msgList.length} messages</Tag>}
        >
          <div className="space-y-3 max-h-[60vh] overflow-y-auto p-2">
            {msgList.map((m, i) => m.role === "user" ? (
              <div key={i} className="text-xs rounded-xl px-3.5 py-2.5 bg-amber-500/15 border border-amber-500/30 text-[#1a1a1a] dark:text-white ml-12 w-fit max-w-[80%] justify-self-end">
                {m.content}
              </div>
            ) : (
              <div
                key={i}
                className="chat-md text-xs leading-relaxed rounded-xl px-4 py-3 bg-black/[0.03] dark:bg-white/[0.03] border border-black/10 dark:border-white/10 text-[#37352f] dark:text-[#d4d4d4] mr-12 max-w-[85%]"
                dangerouslySetInnerHTML={{ __html: md(m.content) }}
              />
            ))}
          </div>
        </BlockCard>
      </div>
    );
  }

  const sessionList = Array.isArray(sessions) ? sessions : (sessions?.sessions ?? []);

  return (
    <BlockCard
      icon="🗂️"
      title="Saved Assistant Sessions in Vault"
      right={<Tag color="gray">{sessionList.length} Archived</Tag>}
    >
      {sessionList.length === 0 ? (
        <div className="text-center py-8">
          <div className="text-2xl mb-2">💬</div>
          <p className="text-xs text-[#888] font-mono">No conversation logs yet.</p>
          <p className="text-[11px] text-[#aaa] mt-1">Open the Antigravity Assistant to ask questions and build your knowledge vault.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {sessionList.map((s) => (
            <div
              key={s.session_id}
              className="group p-3 rounded-xl border border-black/10 dark:border-white/10 hover:border-amber-500/50 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-all flex items-center justify-between gap-3"
            >
              <button
                className="flex-1 text-left min-w-0"
                onClick={() => openSession(s.session_id)}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold text-[#1a1a1a] dark:text-white truncate">
                    {s.first_message?.slice(0, 80) || "(empty conversation)"}
                  </span>
                  <Tag color="blue">{s.messages ?? 0} msgs</Tag>
                </div>
                <div className="text-[11px] font-mono text-[#888]">
                  {s.started_at ? new Date(Number(s.started_at)).toLocaleString() : "Recent session"}
                </div>
              </button>

              <button
                onClick={() => {
                  api.session(s.session_id).then((raw) => {
                    const msgs = Array.isArray(raw) ? raw : (raw?.messages ?? []);
                    onResume(s.session_id, msgs);
                  });
                }}
                className="text-xs font-mono font-medium text-amber-500 hover:text-amber-400 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity whitespace-nowrap px-2.5 py-1 rounded bg-amber-500/10 hover:bg-amber-500/20 shrink-0"
              >
                ↩ Resume →
              </button>
            </div>
          ))}
        </div>
      )}
    </BlockCard>
  );
}

/* ═════════════════════════════════════════════════════════════════════════════
   ANTIGRAVITY-STYLE FLOATING POPUP WINDOW FOR CHAT INTERFACE
═════════════════════════════════════════════════════════════════════════════ */
const NEW_SESSION = () => crypto.randomUUID();

function AntigravityChatModal({ open, onClose, sessionId, msgs, setMsgs, onNewSession, farm, user }) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  const isResumed = msgs.some((m) => m.role === "history");

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
      endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [open, msgs, busy]);

  // Close on Escape key
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && open) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const quickPrompts = [
    { icon: "🍳", text: "What should I cook today?" },
    { icon: "⚠️", text: "What is my current bottleneck?" },
    { icon: "🌸", text: "How much FLOWER to Level 100?" },
    { icon: "📦", text: "Which delivery gives the best return?" },
  ];

  const send = async (text) => {
    if (!text?.trim() || busy) return;
    setMsgs((m) => [...m, { role: "you", text }]);
    setInput("");
    setBusy(true);
    try {
      const r = await api.chat(text, sessionId);
      setMsgs((m) => [...m, { role: "ai", text: r.answer ?? r.error ?? "No response received", steps: r.steps ?? [] }]);
    } catch (err) {
      setMsgs((m) => [...m, { role: "ai", text: `⚠️ Error communicating with server: ${err.message}` }]);
    } finally {
      setBusy(false);
    }
  };

  if (!open) return null;

  const modalContent = (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center select-none transition-all duration-200 ${maximized ? "p-0 bg-transparent" : "p-0 sm:p-4 bg-black/50 dark:bg-black/80 backdrop-blur-xs"
        }`}
      onClick={onClose}
    >
      {/* Antigravity Floating Window Frame */}
      <div
        className={`${maximized
          ? "w-[100vw] h-[100vh] rounded-none"
          : "w-full sm:w-[62rem] max-w-full sm:max-w-[98vw] h-full sm:h-[45rem] max-h-full sm:max-h-[96vh] rounded-none sm:rounded-2xl"
          } bg-white dark:bg-[#18181b] text-[#1a1a1a] dark:text-[#f0f0f0] border-0 sm:border border-black/15 dark:border-white/15 shadow-2xl shadow-black/20 dark:shadow-black/90 flex flex-col overflow-hidden transition-all duration-200`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Antigravity Window Title Bar */}
        <div
          onDoubleClick={() => setMaximized(!maximized)}
          className="h-11 px-4 bg-[#f4f3ef] dark:bg-[#121214] border-b border-black/10 dark:border-white/10 flex items-center justify-between text-xs select-none shrink-0 cursor-default"
        >

          {/* Left Traffic Dots & Window Title */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <button
                onClick={onClose}
                className="w-3 h-3 rounded-full bg-rose-500 hover:bg-rose-600 flex items-center justify-center text-[8px] text-black font-bold opacity-80 hover:opacity-100 transition-opacity"
                title="Close"
              >
                ✕
              </button>
              <button
                onClick={onClose}
                className="w-3 h-3 rounded-full bg-amber-500 hover:bg-amber-600 flex items-center justify-center text-[8px] text-black font-bold opacity-80 hover:opacity-100 transition-opacity"
                title="Minimize"
              >
                —
              </button>
              <button
                onClick={() => setMaximized(!maximized)}
                className="w-3 h-3 rounded-full bg-emerald-500 hover:bg-emerald-600 flex items-center justify-center text-[8px] text-black font-bold opacity-80 hover:opacity-100 transition-opacity"
                title={maximized ? "Restore Size" : "Maximize"}
              >
                ⤢
              </button>
            </div>

            <div className="h-3.5 w-px bg-black/10 dark:bg-white/10" />

            <div className="flex items-center gap-2">
              <span className="text-amber-500 font-bold">✨</span>
              <span className="font-semibold text-[#1a1a1a] dark:text-white font-display text-xs">
                Dr. Bumpkin
              </span>
              <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 dark:bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30 dark:border-amber-500/20 font-medium">
                Gemini
              </span>
            </div>
          </div>

          {/* Center Context Indicator */}
          <div className="hidden md:flex items-center gap-2 text-[11px] font-mono text-[#666] dark:text-[#888]">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            <span>Farm #{user?.farmId || user?.farm_id || "Active"}</span>
            {farm?.bumpkin && <span>· Lv {farm.bumpkin.level}</span>}
          </div>

          {/* Right Window Controls */}
          <div className="flex items-center gap-2">
            <button
              onClick={onNewSession}
              className="flex items-center gap-1 text-[11px] font-mono text-[#444] dark:text-[#aaa] hover:text-[#000] dark:hover:text-white px-2 py-1 rounded bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 border border-black/10 dark:border-white/10 transition-colors"
              title="Start a new session"
            >
              <span>+</span>
              <span>New Session</span>
            </button>

            <button
              onClick={() => setMaximized(!maximized)}
              className="w-7 h-7 rounded flex items-center justify-center text-[#666] dark:text-[#888] hover:text-[#000] dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-xs"
              title={maximized ? "Restore Size" : "Maximize"}
            >
              {maximized ? "❐" : "⤢"}
            </button>

            <button
              onClick={onClose}
              className="w-7 h-7 rounded flex items-center justify-center text-[#666] dark:text-[#888] hover:text-[#000] dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 transition-colors text-sm"
              title="Close (Esc)"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Message Viewport */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4 select-text bg-[#faf9f6] dark:bg-[#18181b]">
          {msgs.length === 0 ? (
            /* Antigravity Welcome Screen */
            <div className="h-full flex flex-col items-center justify-center text-center max-w-lg mx-auto py-8">
              <div className="w-16 h-16 rounded-2xl bg-white dark:bg-[#242429] border border-amber-500/40 dark:border-amber-500/30 flex items-center justify-center text-3xl mb-4 shadow-xl shadow-amber-500/10 select-none">
                <img src="https://animations.sunflower-land.com/animated_webp/0_v1_32_1_5_185_46_22_240_395_0_228_0_0_0_0_0_266/idle-small" alt="Dr. Bumpkin" className="w-10 h-10" />
              </div>
              <h2 className="text-xl font-bold font-display text-[#1a1a1a] dark:text-white mb-1.5">
                How can I help you?
              </h2>
              <p className="text-xs text-[#666] dark:text-[#999] max-w-sm mb-6 font-mono">
                Ask anything about cooking schedules, XP projections, inventory arbitrage, or island delivery priorities.
              </p>

              {/* Antigravity Action Chips */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full">
                {quickPrompts.map((q) => (
                  <button
                    key={q.text}
                    onClick={() => send(q.text)}
                    className="p-3 text-left rounded-xl bg-white dark:bg-[#222227] hover:bg-[#f2f1ec] dark:hover:bg-[#2a2a30] border border-black/10 dark:border-white/5 hover:border-amber-500/50 dark:hover:border-amber-500/40 text-xs text-[#1a1a1a] dark:text-[#d4d4d4] hover:text-black dark:hover:text-white transition-all shadow-sm flex items-center gap-2 group"
                  >
                    <span className="text-sm transition-transform duration-200 group-hover:scale-110">{q.icon}</span>
                    <span className="truncate">{q.text}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Active Message Stream */
            <div className="space-y-4 max-w-3xl mx-auto">
              {msgs.map((m, i) => {
                if (m.role === "history") {
                  return (
                    <div key={i} className="flex items-center gap-3 py-2 select-none">
                      <div className="flex-1 h-px bg-black/10 dark:bg-white/10" />
                      <span className="text-[10px] font-mono text-amber-800 dark:text-amber-400 bg-amber-500/15 dark:bg-amber-500/10 px-2.5 py-0.5 rounded-full border border-amber-500/30 dark:border-amber-500/20">
                        ↩ Resumed Session · {new Date(m.at).toLocaleString()}
                      </span>
                      <div className="flex-1 h-px bg-black/10 dark:bg-white/10" />
                    </div>
                  );
                }

                return m.role === "you" ? (
                  <div key={i} className="flex justify-end">
                    <div className="text-xs leading-relaxed rounded-2xl rounded-tr-sm px-4 py-2.5 bg-amber-500/20 dark:bg-gradient-to-r dark:from-amber-600/30 dark:to-amber-500/20 border border-amber-500/30 text-[#1a1a1a] dark:text-white max-w-[80%] shadow-sm">
                      {m.text}
                    </div>
                  </div>
                ) : (
                  <div key={i} className="flex items-start gap-3">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center text-sm shrink-0 select-none">
                      <img src="/bumpkin-chibi.webp" alt="Dr. Bumpkin" className="w-12 h-12 object-contain [image-rendering:pixelated]" />
                    </div>
                    <div className="flex-1 min-w-0 space-y-2">
                      {m.steps?.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 select-none">
                          {m.steps.map((s, si) => (
                            <span
                              key={si}
                              className={`text-[10px] font-mono px-2 py-0.5 rounded-md border ${s.ok
                                ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-800 dark:bg-white/5 dark:border-white/10 dark:text-emerald-400"
                                : "bg-rose-500/10 border-rose-500/30 text-rose-700 dark:text-rose-400"
                                }`}
                            >
                              ⚡ {s.tool}
                            </span>
                          ))}
                        </div>
                      )}
                      <div
                        className="chat-md text-xs leading-relaxed rounded-2xl rounded-tl-sm p-4 bg-white dark:bg-[#232328] border border-black/10 dark:border-white/10 text-[#222] dark:text-[#e0e0e0] shadow-sm overflow-x-auto"
                        dangerouslySetInnerHTML={{ __html: md(m.text) }}
                      />
                    </div>
                  </div>
                );
              })}

              {busy && (
                <div className="flex items-center gap-2.5 text-xs text-[#666] dark:text-[#888] font-mono p-3 bg-black/5 dark:bg-white/5 rounded-xl border border-black/5 dark:border-white/5 max-w-sm">
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span>
                  <span>Dr. Bumpkin is thinking...</span>
                </div>
              )}
              <div ref={endRef} className="h-px" />
            </div>
          )}
        </div>

        {/* Antigravity Input Composer Dock */}
        <div className="p-3 sm:p-4 bg-[#f4f3ef] dark:bg-[#121214] border-t border-black/10 dark:border-white/10 shrink-0">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex items-center gap-2 bg-white dark:bg-[#222227] border border-black/10 dark:border-white/10 focus-within:border-amber-500 dark:focus-within:border-amber-500/60 rounded-xl p-1.5 transition-all shadow-sm"
          >
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask Dr. Bumpkin (e.g. What should I cook?)..."
              className="flex-1 bg-transparent px-3 py-2 text-xs text-[#1a1a1a] dark:text-white placeholder-[#888] dark:placeholder-[#777] outline-none font-sans"
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              className="px-3 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 font-bold rounded-lg transition-all text-xs flex items-center gap-1.5 shadow-md shadow-amber-500/10"
            >
              <span>Send</span>
              <span>➤</span>
            </button>
          </form>

          <div className="mt-2 px-1 flex items-center justify-between text-[10px] font-mono text-[#777] select-none">
            <span>Dr. Bumpkin has access to your live farm data</span>
            <span>Enter ↵ to send · Esc to close</span>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}

/* ═════════════════════════════════════════════════════════════════════════════
   FARM ONBOARDING GATE (NOTION WORKSPACE SETUP)
═════════════════════════════════════════════════════════════════════════════ */
function FarmSetup() {
  const { updateFarmId, logout, user } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [farmId, setFarmId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    const id = farmId.trim();
    if (!id || isNaN(Number(id))) {
      setError('Please enter a valid numeric Farm ID.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const result = await updateFarmId(id);
      if (!result.success) {
        setError(result.error || 'Failed to link Farm ID. Please ensure this farm exists.');
      }
    } catch {
      setError('An error occurred during verification.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#faf9f6] dark:bg-[#191919] text-[#1a1a1a] dark:text-[#e6e6e6] p-4 transition-colors duration-200">
      <div className="w-full max-w-lg bg-white dark:bg-[#202020] border border-black/10 dark:border-white/10 rounded-2xl p-5 md:p-8 shadow-2xl shadow-black/10 dark:shadow-black/80 transition-colors duration-200 relative">
        {/* Top Right Quick Theme Switcher */}
        <div className="absolute top-4 right-4 flex items-center gap-2">
          <button
            type="button"
            onClick={toggleTheme}
            className="p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/10 text-xs text-[#888] transition-colors"
            title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
          >
            {theme === 'light' ? '🌙' : '☀️'}
          </button>
        </div>

        {/* Cover / Icon */}
        <div className="text-center mb-6">
          <div className="w-16 h-16 mx-auto mb-3 rounded-2xl bg-black/5 dark:bg-[#2b2b2b] border border-black/10 dark:border-white/10 flex items-center justify-center text-3xl shadow-inner">
            🚜
          </div>
          <h1 className="text-2xl font-bold font-display text-[#1a1a1a] dark:text-white mb-1">
            Initialize Farm Workspace
          </h1>
          <p className="text-xs text-[#787774] dark:text-[#8e8e8e]">
            Welcome, <span className="font-semibold text-amber-600 dark:text-amber-400">{user?.username}</span>. Link your Sunflower Land Farm NFT to establish isolated state and analytics.
          </p>
        </div>

        {/* Notion-style Info Callout */}
        <div className="mb-6 p-4 rounded-xl bg-black/[0.02] dark:bg-[#262626] border border-black/5 dark:border-white/5 text-xs text-[#666] dark:text-[#aaa] space-y-2">
          <div className="font-semibold text-[#1a1a1a] dark:text-white flex items-center gap-1.5">
            <span>🔎</span> Locating Your Farm NFT ID:
          </div>
          <ol className="list-decimal list-inside space-y-1 text-[#787774] dark:text-[#8e8e8e] font-mono text-[11px]">
            <li>Open Sunflower Land (<a href="https://sunflower-land.com" target="_blank" rel="noreferrer" className="underline text-amber-600 dark:text-amber-400">sunflower-land.com</a>)</li>
            <li>Inspect the farm number displayed in the top-left HUD (e.g. #29411)</li>
            <li>Enter only the numeric digits below</li>
          </ol>
        </div>

        {error && (
          <div className="mb-4 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-300 text-xs">
            ⚠️ {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-mono text-[#787774] dark:text-[#888] mb-1.5 uppercase">
              Sunflower Land Farm ID
            </label>
            <input
              type="number"
              min="1"
              value={farmId}
              onChange={(e) => setFarmId(e.target.value)}
              className="w-full bg-black/[0.03] dark:bg-[#161616] border border-black/10 dark:border-white/10 rounded-xl px-4 py-3 text-[#1a1a1a] dark:text-white placeholder-[#999] dark:placeholder-[#555] font-mono text-lg outline-none focus:border-amber-500 transition-all"
              placeholder="e.g. 29411"
              required
              autoFocus
            />
          </div>

          <button
            type="submit"
            disabled={loading || !farmId.trim()}
            className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-bold py-3 rounded-xl text-sm transition-all shadow-lg shadow-amber-500/10"
          >
            {loading ? "Verifying On-Chain Data..." : "Bind Farm to Workspace ↵"}
          </button>
        </form>

        <div className="mt-6 pt-4 border-t border-black/5 dark:border-white/5 text-center">
          <button
            onClick={logout}
            className="text-xs text-[#787774] dark:text-[#666] hover:text-[#1a1a1a] dark:hover:text-[#aaa] transition-colors font-mono"
          >
            ← Sign out and switch accounts
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════════════
   PAGE ICON HELPER: SUPPORTS ANIMATED WEBP, IMAGES, & EMOJIS WITH PIXEL ART STYLE
═════════════════════════════════════════════════════════════════════════════ */
function PageIcon({ icon, alt = "", className = "w-4 h-4" }) {
  if (!icon) return null;
  const isImage =
    typeof icon === "string" &&
    (icon.startsWith("/") ||
      icon.startsWith("http") ||
      icon.startsWith("./") ||
      icon.startsWith("../") ||
      /\.(webp|png|gif|svg|avif|jpe?g)$/i.test(icon));

  if (isImage) {
    return (
      <img
        src={icon}
        alt={alt}
        className={`${className} object-contain inline-block [image-rendering:pixelated] select-none shrink-0`}
        loading="eager"
      />
    );
  }

  return <span className="inline-block select-none leading-none">{icon}</span>;
}

/* ═════════════════════════════════════════════════════════════════════════════
   MAIN APP SHELL: OBSIDIAN RIBBON + NOTION WORKSPACE + CANVAS + STATUS BAR
═════════════════════════════════════════════════════════════════════════════ */
const PAGES = [
  { id: "Dashboard", title: "Overview", icon: "/bumpkin-chibi (2).webp", category: "Core Operations" },
  { id: "Planner", title: "Cooking & XP Planner", icon: "/bumpkin-chibi (4).webp", category: "Core Operations" },
  { id: "Recipes", title: "Recipe Catalogue", icon: "/npc-betty-chibi.webp", category: "Core Operations" },
  { id: "Market", title: "Market & Valuation", icon: "/npc-hammerin-harry-chibi.webp", category: "Intelligence" },
  { id: "Activity", title: "Delta Tracker", icon: "/bumpkin-chibi (1).webp", category: "Intelligence" },
  { id: "Quests", title: "Chores & Deliveries", icon: "/bumpkin-chibi (3).webp", category: "Intelligence" },
  { id: "History", title: "Vault Sessions", icon: "/bumpkin-chibi.webp", category: "Vault Memory" },
];

export default function App() {
  const [tab, setTab] = useState("Dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [farm, setFarm] = useState(null);
  const [plan, setPlan] = useState(null);
  const [market, setMarket] = useState(null);
  const [recipesData, setRecipesData] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showUserMenu, setShowUserMenu] = useState(false);

  const { theme, toggleTheme } = useTheme();
  const { user, loading, isAuthenticated, logout } = useAuth();

  // Chat copilot state
  const [sessionId, setSessionId] = useState(() => NEW_SESSION());
  const [msgs, setMsgs] = useState([]);

  const handleResume = (id, historyMsgs) => {
    const converted = historyMsgs.map((m) => ({
      role: m.role === "user" ? "you" : "ai",
      text: m.content,
    }));
    setSessionId(id);
    setMsgs([{ role: "history", at: Number(historyMsgs[0]?.created_at) || Date.now() }, ...converted]);
    setCopilotOpen(true);
  };

  const load = async () => {
    setRefreshing(true);
    try {
      const [f, p, m, rec] = await Promise.all([
        api.farm().catch(() => null),
        api.planner().catch(() => null),
        api.market().catch(() => null),
        api.recipes().catch(() => null),
      ]);
      if (f) setFarm(f);
      if (p) setPlan(p);
      if (m) setMarket(m);
      if (rec) setRecipesData(rec);
    } finally {
      setRefreshing(false);
    }
  };

  const activeFarmId = user?.farmId || user?.farm_id;
  useEffect(() => {
    if (activeFarmId) load();
  }, [activeFarmId]);

  // Keyboard shortcut: Ctrl+J / Cmd+J to toggle AI Copilot
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setCopilotOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#faf9f6] dark:bg-[#191919] text-[#1a1a1a] dark:text-white transition-colors duration-200">
        <div className="text-center font-mono text-xs">
          <div className="w-12 h-12 mx-auto mb-3 rounded-xl bg-white dark:bg-[#262626] border border-black/10 dark:border-white/10 flex items-center justify-center text-2xl animate-pulse shadow-sm">
            🌻
          </div>
          <span className="text-[#787774] dark:text-[#888]">Unlocking Vault...</span>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) return <AuthScreen />;
  if (!user?.farmId && !user?.farm_id) return <FarmSetup />;

  const currentPage = PAGES.find((p) => p.id === tab) || PAGES[0];

  return (
    <div className="h-screen flex flex-col bg-[var(--canvas-bg)] text-[var(--text-primary)] select-none overflow-hidden">

      {/* ─── Top Obsidian Window / Tab Header ─────────────────────────────── */}
      <header className="h-10 shrink-0 bg-[#f1f0ea] dark:bg-[#161616] border-b border-black/10 dark:border-white/10 flex items-center justify-between px-2.5 sm:px-3 text-xs z-30">
        <div className="flex items-center gap-1 sm:gap-2 overflow-x-auto no-scrollbar min-w-0 flex-1 mr-2">
          {/* Obsidian Window Traffic Dots (Desktop) */}
          <div className="hidden sm:flex items-center gap-1.5 mr-1 shrink-0">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500/60 inline-block"></span>
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/60 inline-block"></span>
            <span className="w-2.5 h-2.5 rounded-full bg-green-500/60 inline-block"></span>
          </div>

          {/* Obsidian Document Tabs */}
          <div className="flex items-center">
            {PAGES.map((p) => (
              <button
                key={p.id}
                onClick={() => setTab(p.id)}
                className={`obsidian-tab shrink-0 ${tab === p.id ? "active" : ""}`}
              >
                <PageIcon icon={p.icon} alt={p.id} className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                <span className="truncate max-w-[90px] sm:max-w-[120px]">{p.id}</span>
                <span className="text-[10px] opacity-40 hover:opacity-100 ml-1 hidden sm:inline">×</span>
              </button>
            ))}
          </div>
        </div>

        {/* Top Right Quick Utilities */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Live Sync Status Pill */}
          <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] font-mono px-1.5 sm:px-2 py-0.5 rounded bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 shrink-0">
            <span className={`w-1.5 h-1.5 rounded-full ${farm?.stale ? "bg-amber-400" : "bg-emerald-400 animate-pulse"}`}></span>
            <span className="text-[#888] hidden sm:inline">{farm?.stale ? "Stale" : "Live API"}</span>
          </div>

          {/* Refresh Button */}
          <button
            onClick={load}
            disabled={refreshing}
            className={`p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/10 text-[#888] hover:text-[#1a1a1a] dark:hover:text-white transition-all shrink-0 ${refreshing ? "animate-spin text-amber-500" : ""}`}
            title="Refresh Farm Data"
          >
            🔄
          </button>

          {/* AI Copilot Drawer Toggle */}
          <button
            onClick={() => setCopilotOpen(!copilotOpen)}
            className={`flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium border transition-all shrink-0 ${copilotOpen ? "bg-amber-500 text-slate-950 font-bold border-amber-400" : "bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 hover:border-amber-500/40 text-amber-600 dark:text-amber-400"}`}
            title="Toggle Dr. Bumpkin (Ctrl+J)"
          >
            <img src="/bumpkin-chibi.webp" alt="Dr. Bumpkin" className="w-3.5 h-3.5 sm:w-4 sm:h-4 object-contain [image-rendering:pixelated] shrink-0" />
            <span className="hidden md:inline">Dr. Bumpkin</span>
            <span className="text-[10px] opacity-60 font-mono hidden sm:inline">⌘J</span>
          </button>

          {/* Theme Toggle */}
          <button
            onClick={toggleTheme}
            className="p-1.5 rounded hover:bg-black/5 dark:hover:bg-white/10 text-xs text-[#888] shrink-0"
            title={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`}
          >
            {theme === 'light' ? '🌙' : '☀️'}
          </button>
        </div>
      </header>

      {/* ─── Main Workspace Body (Ribbon + Sidebar + Canvas + Copilot) ─────── */}
      <div className="flex-1 flex min-h-0 overflow-hidden relative">

        {/* 1. Left Tool Ribbon (Discord style on mobile, Obsidian style on desktop) */}
        <div className="w-12 shrink-0 bg-[#ebe9e4] dark:bg-[#141414] border-r border-black/10 dark:border-white/10 flex flex-col items-center py-2.5 md:py-3 justify-between z-20 select-none">
          <div className="flex flex-col items-center gap-1.5 md:gap-2 w-full">
            {/* Desktop: Obsidian Folder Toggle to expand/collapse Notion Sidebar */}
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="hidden md:flex w-8 h-8 rounded-lg items-center justify-center hover:bg-black/10 dark:hover:bg-white/10 text-base transition-colors"
              title={sidebarOpen ? "Hide Notion Sidebar" : "Show Notion Sidebar"}
            >
              📂
            </button>

            {/* Mobile: Discord Server Brand Home Icon (No expandability on mobile) */}
            <button
              onClick={() => setTab("Dashboard")}
              className="flex md:hidden w-8 h-8 rounded-2xl items-center justify-center transition-all bg-black/5 dark:bg-white/5 hover:bg-amber-500/20 text-[#37352f] dark:text-white"
              title="Overview"
            >
              <span className="text-base">🌻</span>
            </button>

            <div className="w-6 h-px bg-black/10 dark:bg-white/10 my-0.5 md:my-1" />

            {/* Navigation Icons:
                On Desktop (md:): shows the exact original top 4 icons (PAGES.slice(0, 4)),
                On Mobile (< md): shows all 7 icons so mobile user can navigate all tabs */}
            <div className="flex flex-col items-center gap-1.5 md:gap-2 w-full overflow-y-auto no-scrollbar max-h-[calc(100vh-190px)] py-0.5">
              {PAGES.map((p, idx) => (
                <button
                  key={p.id}
                  onClick={() => setTab(p.id)}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm transition-all ${idx >= 4 ? "flex md:hidden" : "flex"
                    } ${tab === p.id ? "bg-amber-500/20 text-amber-500 font-bold border border-amber-500/30" : "hover:bg-black/5 dark:hover:bg-white/5 opacity-60 hover:opacity-100"}`}
                  title={p.title}
                >
                  <PageIcon icon={p.icon} alt={p.title} className="w-5 h-5" />
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col items-center gap-1.5 md:gap-2 w-full relative">
            {/* Dr. Bumpkin Copilot Toggle */}
            <button
              onClick={() => setCopilotOpen(!copilotOpen)}
              className={`w-8 h-8 rounded-lg flex items-center justify-center text-sm transition-all ${copilotOpen ? "bg-amber-500 text-slate-950 font-bold" : "hover:bg-black/5 dark:hover:bg-white/5 text-amber-500"}`}
              title="Dr. Bumpkin"
            >
              <img src="/bumpkin-chibi.webp" alt="Dr. Bumpkin" className="w-6 h-6 object-contain [image-rendering:pixelated] shrink-0" />
            </button>
            <div className="w-6 h-px bg-black/10 dark:bg-white/10 my-0.5 md:my-1" />

            {/* Theme Toggle */}
            <button
              onClick={toggleTheme}
              className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-black/10 dark:hover:bg-white/10 text-xs opacity-70 hover:opacity-100"
              title="Theme Toggle"
            >
              {theme === 'light' ? '🌙' : '☀️'}
            </button>

            {/* Mobile Only: User Avatar with account popover (since Notion sidebar is disabled on mobile) */}
            <div className="md:hidden relative mt-0.5">
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="w-7 h-7 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-700 dark:text-amber-400 font-bold text-xs flex items-center justify-center"
                title={`${user?.username} · Farm #${activeFarmId}`}
              >
                {user?.username ? user.username.charAt(0).toUpperCase() : "🧑‍🌾"}
              </button>

              {showUserMenu && (
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowUserMenu(false)}
                />
              )}

              {showUserMenu && (
                <div
                  className="absolute bottom-0 left-10 w-56 bg-white dark:bg-[#282828] border border-black/10 dark:border-white/10 rounded-xl shadow-xl p-2.5 z-50 text-xs"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="px-2 py-1 border-b border-black/5 dark:border-white/5 text-[11px] font-mono text-[#888]">
                    <div className="font-bold text-[#1a1a1a] dark:text-white truncate">{user?.username}</div>
                    <div>Farm: #{activeFarmId}</div>
                  </div>
                  <a
                    href={`https://sunflower-land.com/play/?farmId=${activeFarmId}`}
                    target="_blank"
                    rel="noreferrer"
                    className="block px-2 py-1.5 rounded hover:bg-black/5 dark:hover:bg-white/5 text-amber-600 dark:text-amber-400 font-medium transition-colors"
                  >
                    Open SFL ↗
                  </a>
                  <button
                    onClick={() => { logout(); setShowUserMenu(false); }}
                    className="w-full text-left px-2 py-1.5 rounded text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 font-medium transition-colors"
                  >
                    Sign Out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 2. Notion Workspace Sidebar (Collapsible Document Tree - DESKTOP ONLY) */}
        {sidebarOpen && (
          <aside className="hidden md:flex w-60 shrink-0 bg-[#f7f6f3] dark:bg-[#202020] border-r border-black/10 dark:border-white/10 flex-col justify-between select-none">
            <div className="p-3 flex flex-col min-h-0 overflow-y-auto">
              {/* Workspace Switcher Header */}
              <div className="relative mb-3">
                <button
                  onClick={() => setShowUserMenu(!showUserMenu)}
                  className="w-full flex items-center justify-between p-1.5 rounded-lg hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-left"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="w-5 h-5 rounded bg-amber-500 flex items-center justify-center text-xs font-bold text-slate-950 shrink-0">
                      🌻
                    </div>
                    <div className="truncate">
                      <div className="text-xs font-bold text-[#1a1a1a] dark:text-white truncate">SFL Shanty</div>
                      <div className="text-[10px] text-[#888] truncate">{user?.username}'s Vault</div>
                    </div>
                  </div>
                  <span className="text-[10px] opacity-60">▾</span>
                </button>

                {/* Account Popover Menu */}
                {showUserMenu && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-[#282828] border border-black/10 dark:border-white/10 rounded-xl shadow-xl p-2 z-50 text-xs">
                    <div className="px-2 py-1.5 border-b border-black/5 dark:border-white/5 text-[11px] font-mono text-[#888]">
                      <div>User: {user?.username}</div>
                      <div>Farm: #{activeFarmId}</div>
                    </div>
                    <button
                      onClick={() => { toggleTheme(); }}
                      className="w-full text-left px-2 py-1.5 mt-1 rounded text-[#555] dark:text-[#aaa] hover:bg-black/5 dark:hover:bg-white/5 font-medium transition-colors flex items-center justify-between"
                    >
                      <span>Theme</span>
                      <span className="font-mono text-[11px]">{theme === 'dark' ? '☀️ Light' : '🌙 Dark'}</span>
                    </button>
                    <button
                      onClick={() => { logout(); setShowUserMenu(false); }}
                      className="w-full text-left px-2 py-1.5 mt-0.5 rounded text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 font-medium transition-colors"
                    >
                      Sign Out
                    </button>
                  </div>
                )}
              </div>

              {/* Quick Search Input */}
              <div className="relative mb-4">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Quick find... (Ctrl+K)"
                  className="w-full bg-black/5 dark:bg-black/20 border border-black/5 dark:border-white/5 rounded-lg px-2.5 py-1.5 text-xs text-[#37352f] dark:text-white placeholder-[#888] outline-none focus:border-amber-500/50 transition-all font-sans"
                />
              </div>

              {/* Tree Sections */}
              <div className="space-y-4 text-xs">
                {["Core Operations", "Intelligence", "Vault Memory"].map((category) => {
                  const items = PAGES.filter((p) => p.category === category && (!searchQuery || p.title.toLowerCase().includes(searchQuery.toLowerCase()) || p.id.toLowerCase().includes(searchQuery.toLowerCase())));
                  if (items.length === 0) return null;
                  return (
                    <div key={category}>
                      <div className="px-2 mb-1 text-[10px] font-mono font-semibold uppercase tracking-wider text-[#888]">
                        {category}
                      </div>
                      <div className="space-y-0.5">
                        {items.map((p) => (
                          <button
                            key={p.id}
                            onClick={() => setTab(p.id)}
                            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition-colors text-left ${tab === p.id ? "bg-black/10 dark:bg-white/10 font-semibold text-[#1a1a1a] dark:text-white" : "text-[#787774] dark:text-[#999] hover:bg-black/5 dark:hover:bg-white/5 hover:text-[#1a1a1a] dark:hover:text-white"}`}
                          >
                            <span className="flex items-center gap-2 truncate">
                              <PageIcon icon={p.icon} alt={p.title} className="w-4 h-4" />
                              <span className="truncate">{p.title}</span>
                            </span>
                            {p.id === "Dashboard" && farm && (
                              <span className="text-[10px] font-mono text-amber-500">Lv {farm.bumpkin.level}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Sidebar Footer: Farm NFT Badge */}
            <div className="p-3 border-t border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-black/10">
              <a
                href={`https://sunflower-land.com/play/?farmId=${activeFarmId}`}
                target="_blank"
                rel="noreferrer"
                className="block p-2.5 rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#252525] hover:border-amber-500/50 transition-all group"
              >
                <div className="flex items-center justify-between text-xs font-semibold text-[#1a1a1a] dark:text-white mb-1">
                  <span>Farm #{activeFarmId}</span>
                  <span className="text-[10px] font-mono text-amber-500 group-hover:underline">Open SFL ↗</span>
                </div>
                <div className="text-[10px] font-mono text-[#888]">
                  Bumpkin Lv {farm?.bumpkin.level ?? "—"} · FLOWER {Number(farm?.currencies.flowerApprox ?? 0).toFixed(1)}
                </div>
              </a>
            </div>
          </aside>
        )}

        {/* 3. Center Canvas (Notion Page Document View) */}
        <main className="flex-1 min-w-0 overflow-y-auto bg-[var(--canvas-bg)]">
          <div className="max-w-4xl mx-auto px-3.5 py-6 pb-28 sm:px-6 sm:py-8 sm:pb-8 md:px-6 md:py-8 md:pb-8">

            {/* Notion Breadcrumbs */}
            <div className="flex items-center gap-1.5 text-[11px] sm:text-xs text-[#888] font-mono mb-3 sm:mb-4">
              <span>SFL Shanty</span>
              <span>/</span>
              <span>{user?.username}</span>
              <span>/</span>
              <span className="text-[#37352f] dark:text-white font-medium">{currentPage.id}</span>
            </div>

            {/* Notion Page Cover & Title Header */}
            <div className="mb-5 sm:mb-6">
              <div className="text-3xl md:text-4xl select-none mb-2.5 sm:mb-3 inline-flex items-center justify-center w-12 h-12 md:w-14 md:h-14 rounded-2xl bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/10 shadow-inner">
                <PageIcon icon={currentPage.icon} alt={currentPage.title} className="w-8 h-8 md:w-10 md:h-10" />
              </div>
              <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight text-[#1a1a1a] dark:text-white font-display mb-1">
                {currentPage.title}
              </h1>
              <p className="text-[11px] sm:text-xs text-[#888] font-mono">
                Real-time operational dashboard and tactical automation node
              </p>
            </div>

            {/* Notion Collapsible Frontmatter Properties Drawer */}
            <div className="mb-6 md:mb-8 p-2.5 md:p-3 rounded-xl border border-black/10 dark:border-white/10 bg-[#fbfbfa] dark:bg-[#202020] space-y-0.5">
              <PropertyItem icon="🧑‍🌾" label="Farm Account" value={`${user?.username} (ID: ${activeFarmId})`} />
              <PropertyItem icon="⭐" label="Bumpkin Tier" value={farm ? `Level ${farm.bumpkin.level} (${fmt(farm.bumpkin.xp)} XP)` : "Loading..."} />
              <PropertyItem icon="🌸" label="Liquid FLOWER" value={farm ? `${Number(farm.currencies.flowerApprox).toFixed(2)} FLOWER` : "—"} />
              <PropertyItem icon="🎯" label="Target Milestone" value="Level 100 Bumpkin Mastery" />
              <PropertyItem icon="⚡" label="Data Synchronization" value={farm?.stale ? "Stale Cache" : "Live Polygon RPC & SFL Gateway"} />
            </div>

            {/* Active Document Page Body */}
            {tab === "Dashboard" && <Dashboard farm={farm} plan={plan} />}
            {tab === "Planner" && <Planner plan={plan} />}
            {tab === "Recipes" && <Recipes recipesData={recipesData} />}
            {tab === "Market" && <Market farm={farm} market={market} />}
            {tab === "Activity" && <Activity />}
            {tab === "Quests" && <Quests farm={farm} />}
            {tab === "History" && <History onResume={handleResume} />}
          </div>
        </main>

        {/* Antigravity-Style Floating Popup Window for Chat Interface */}
        <AntigravityChatModal
          open={copilotOpen}
          onClose={() => setCopilotOpen(false)}
          sessionId={sessionId}
          msgs={msgs}
          setMsgs={setMsgs}
          onNewSession={() => {
            setSessionId(NEW_SESSION());
            setMsgs([]);
          }}
          farm={farm}
          user={user}
        />
      </div>

      {/* Floating Antigravity Launcher Button (Bottom-Right) */}
      {!copilotOpen && (
        <button
          onClick={() => setCopilotOpen(true)}
          className="fixed bottom-8 right-3 sm:bottom-9 sm:right-6 md:bottom-9 md:right-6 z-40 flex items-center gap-1.5 md:gap-2 px-2.5 py-1.5 md:px-3.5 md:py-2 rounded-full bg-white dark:bg-[#18181b] border border-black/15 dark:border-amber-500/40 hover:border-amber-500 text-[#1a1a1a] dark:text-white shadow-xl shadow-black/15 dark:shadow-black/60 hover:scale-105 transition-all group select-none"
          title="Open Dr. Bumpkin (Ctrl+J)"
        >
          <span className="text-amber-500 dark:text-amber-400 text-xs md:text-sm group-hover:rotate-12 transition-transform">✨</span>
          <span className="text-[11px] md:text-xs font-semibold font-display">Ask Dr. Bumpkin</span>
          <span className="hidden sm:inline-block text-[10px] font-mono text-[#666] dark:text-[#aaa] bg-black/5 dark:bg-white/10 px-1.5 py-0.5 rounded">⌘J</span>
          <span className="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-emerald-500 dark:bg-emerald-400 animate-pulse"></span>
        </button>
      )}

      {/* ─── Bottom Obsidian Status Bar ───────────────────────────────────── */}
      <footer className="h-6 shrink-0 bg-[#ebe9e4] dark:bg-[#121212] border-t border-black/10 dark:border-white/10 px-2.5 sm:px-3 flex items-center justify-between text-[11px] font-mono text-[#787774] dark:text-[#777] z-30 select-none">
        <div className="flex items-center gap-2 sm:gap-3 truncate">
          <span className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${farm?.stale ? "bg-amber-400" : "bg-emerald-400"}`}></span>
            <span className="truncate">{farm?.stale ? "Cache Mode" : "Live Engine"}</span>
          </span>
          <span className="opacity-40">|</span>
          <span className="truncate">Farm: #{activeFarmId}</span>
          <span className="opacity-40 hidden xs:inline">|</span>
          <span className="hidden xs:inline truncate">Bumpkin: Lv {farm?.bumpkin.level ?? "—"}</span>
        </div>

        <div className="hidden sm:flex items-center gap-3 shrink-0">
          <span>FLOWER: {Number(farm?.currencies.flowerApprox ?? 0).toFixed(2)}</span>
          <span className="opacity-40">|</span>
          <span className="text-amber-500 font-medium">Obsidian + Notion Hybrid v2.4</span>
        </div>
      </footer>
    </div>
  );
}

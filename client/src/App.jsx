import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { marked } from "marked";
import { api } from "./api.js";
import { useAuth } from "./authContext.jsx";
import { AuthScreen } from "./Auth.jsx";
import {
  selectOverviewData,
  selectCookingData,
  selectCropData,
  selectAnimalData,
  selectResourceData,
  selectEffectData,
  BUILDING_CATEGORIES,
  selectCategoryBuildings,
  selectProcessingData,
} from "./selectors/dashboardSelectors.js";

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
   TAB 1: DASHBOARD (CATEGORY TABS & VIEW-MODEL PRESENTATION)
═════════════════════════════════════════════════════════════════════════════ */
function CategoryTabs({ activeCategory, onChange, counts = {} }) {
  const categories = [
    { id: "overview", label: "Overview", icon: "🌟" },
    { id: "cooking", label: "Cooking", icon: "🍳", badge: counts.cooking },
    { id: "crops", label: "Crops & Greenhouse", icon: "🌱", badge: counts.crops },
    { id: "animals", label: "Animals & Barn", icon: "🐄", badge: counts.animals },
    { id: "resources", label: "Mining & Resources", icon: "⛏️", badge: counts.resources },
    { id: "effects", label: "Collectibles & Buffs", icon: "⚡", badge: counts.effects },
  ];

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-black/10 dark:border-white/10 no-scrollbar">
      {categories.map((cat) => {
        const isActive = activeCategory === cat.id;
        return (
          <button
            key={cat.id}
            type="button"
            onClick={() => onChange(cat.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg transition-all whitespace-nowrap select-none font-medium cursor-pointer ${
              isActive
                ? "bg-black/5 dark:bg-white/10 text-[#1a1a1a] dark:text-white font-semibold border border-black/10 dark:border-white/15 shadow-xs"
                : "text-[#787774] dark:text-[#888] hover:text-[#1a1a1a] dark:hover:text-white hover:bg-black/[0.03] dark:hover:bg-white/[0.04] border border-transparent"
            }`}
          >
            <span className="text-xs">{cat.icon}</span>
            <span>{cat.label}</span>
            {cat.badge != null && cat.badge > 0 ? (
              <span
                className={`text-[10px] font-mono px-1.5 py-0.2 rounded-full ${
                  isActive
                    ? "bg-amber-500/20 text-amber-700 dark:text-amber-300"
                    : "bg-black/5 dark:bg-white/10 text-[#888]"
                }`}
              >
                {cat.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

function OverviewPanel({ data, farm, plan }) {
  const kpis = data.kpis;
  const health = data.health;
  const pct = kpis.pctComplete || Math.min((kpis.xp / kpis.targetXp) * 100, 100).toFixed(1);
  const buildings = data.buildings ?? [];

  return (
    <div className="space-y-6">
      {/* Road to Level 100 Progress Card */}
      <BlockCard
        icon="🎯"
        title="Road to Level 100 Milestone"
        right={<Tag color="amber">{pct}% Complete · {fmt(kpis.remainingXp)} XP left</Tag>}
      >
        <div className="space-y-3">
          <div className="w-full bg-black/5 dark:bg-black/40 h-3 rounded-full overflow-hidden p-0.5 border border-black/10 dark:border-white/10">
            <div
              className="bg-gradient-to-r from-amber-500 to-yellow-400 h-full rounded-full transition-all duration-500 shadow-sm"
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex items-center justify-between text-xs text-[#787774] dark:text-[#888] font-mono">
            <span>Level {kpis.level} ({fmt(kpis.xp)} XP)</span>
            <span>Target: Level 100 ({fmt(kpis.targetXp)} XP)</span>
          </div>
        </div>
      </BlockCard>

      {/* Quick Department Health Matrix */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        <div className="p-3 bg-white dark:bg-[#202020] border border-black/10 dark:border-white/10 rounded-xl">
          <div className="text-[11px] text-[#888] flex items-center gap-1.5 mb-1">
            <span>🏠</span> Buildings
          </div>
          <div className="text-lg font-bold font-mono text-[#1a1a1a] dark:text-white">
            {buildings.length || health.totalBuildingsCount || 0} <span className="text-xs font-normal text-[#888]">active</span>
          </div>
        </div>
        <div className="p-3 bg-white dark:bg-[#202020] border border-black/10 dark:border-white/10 rounded-xl">
          <div className="text-[11px] text-[#888] flex items-center gap-1.5 mb-1">
            <span>🍳</span> Cooking
          </div>
          <div className="text-lg font-bold font-mono text-[#1a1a1a] dark:text-white">
            {health.activeCookingCount} <span className="text-xs font-normal text-[#888]">busy</span>
          </div>
        </div>
        <div className="p-3 bg-white dark:bg-[#202020] border border-black/10 dark:border-white/10 rounded-xl">
          <div className="text-[11px] text-[#888] flex items-center gap-1.5 mb-1">
            <span>🌱</span> Crops
          </div>
          <div className="text-lg font-bold font-mono text-[#1a1a1a] dark:text-white">
            {health.activeCropsCount} <span className="text-xs font-normal text-[#888]">in ground</span>
          </div>
        </div>
        <div className="p-3 bg-white dark:bg-[#202020] border border-black/10 dark:border-white/10 rounded-xl">
          <div className="text-[11px] text-[#888] flex items-center gap-1.5 mb-1">
            <span>🐄</span> Livestock
          </div>
          <div className="text-lg font-bold font-mono text-[#1a1a1a] dark:text-white">
            {health.animalsCount} <span className="text-xs font-normal text-[#888]">animals</span>
          </div>
        </div>
        <div className="p-3 bg-white dark:bg-[#202020] border border-black/10 dark:border-white/10 rounded-xl">
          <div className="text-[11px] text-[#888] flex items-center gap-1.5 mb-1">
            <span>⛏️</span> Resources
          </div>
          <div className="text-lg font-bold font-mono text-[#1a1a1a] dark:text-white">
            {health.resourcesCount} <span className="text-xs font-normal text-[#888]">nodes</span>
          </div>
        </div>
        <div className="p-3 bg-white dark:bg-[#202020] border border-black/10 dark:border-white/10 rounded-xl">
          <div className="text-[11px] text-[#888] flex items-center gap-1.5 mb-1">
            <span>⚡</span> Boosts
          </div>
          <div className="text-lg font-bold font-mono text-[#1a1a1a] dark:text-white">
            {health.placedCollectiblesCount} <span className="text-xs font-normal text-[#888]">placed</span>
          </div>
        </div>
      </div>

      {/* Farm Buildings & Island Infrastructure */}
      {buildings.length > 0 && (
        <BlockCard
          icon="🏠"
          title="Island Buildings & Active Facilities"
          right={<Tag color="blue">{buildings.length} Active Facilities</Tag>}
        >
          <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
            {buildings.map((b, idx) => (
              <div
                key={b.name + idx}
                className="p-3 rounded-xl border border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.02] flex items-center justify-between"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="text-lg select-none shrink-0">{b.icon || "🏠"}</span>
                  <div className="truncate">
                    <div className="font-semibold text-xs text-[#1a1a1a] dark:text-white font-sans truncate">
                      {b.name}
                    </div>
                    <div className="text-[10px] text-[#888] font-mono">
                      {b.category} {b.oil > 0 ? `· 🛢️ ${b.oil.toFixed(1)} oil` : ""}
                    </div>
                  </div>
                </div>
                <div className="shrink-0 ml-2">
                  {b.isBusy ? (
                    <Tag color="amber">Active</Tag>
                  ) : (
                    <Tag color="gray">Idle</Tag>
                  )}
                </div>
              </div>
            ))}
          </div>
        </BlockCard>
      )}

      {/* Active Production & Yield Pipeline (Phase 1 & 2 Deterministic Tracking) */}
      {farm?.activeProduction && Object.keys(farm.activeProduction.byItem ?? {}).length > 0 && (
        <BlockCard
          icon="🌱"
          title="Active Production & Yield Projections"
          right={
            <Tag color={farm.activeProduction.activeCount > 0 ? "green" : "gray"}>
              {farm.activeProduction.activeCount} In Flight · {farm.activeProduction.completedCount} Ready
            </Tag>
          }
        >
          <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-2.5">
            {Object.entries(farm.activeProduction.byItem).map(([item, summary]) => (
              <div
                key={item}
                className="p-2.5 rounded-lg border border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.02] flex items-center justify-between font-mono text-xs"
              >
                <div>
                  <div className="font-semibold text-[#1a1a1a] dark:text-white font-sans">{item}</div>
                  <div className="text-[10px] text-[#888]">Qty: {summary.totalQuantity} items</div>
                </div>
                <div className="text-right">
                  <div className="text-emerald-600 dark:text-emerald-400 font-bold">+{summary.expectedOutput} yield</div>
                  <div className="text-[10px] text-[#888]">{summary.latestReadyAt <= Date.now() ? '✓ Ready' : 'In Ground'}</div>
                </div>
              </div>
            ))}
          </div>
        </BlockCard>
      )}

      {/* Plan Alert if Unaffordable */}
      {plan && !plan.affordable && (
        <Callout icon="⚠️" type="warning" title="Resource Deficit Warning">
          {plan.notes.join(" ")}
        </Callout>
      )}

      {/* Cooking Pipeline Recipes Preview */}
      {plan && plan.buildings && plan.buildings.length > 0 && (
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

function CookingPanel({ data, plan }) {
  const buildings = data?.buildings ?? [];
  const foodInventory = data?.foodInventory ?? {};
  const totalMeals = data?.totalMealsInStock ?? 0;
  const foodEntries = Object.entries(foodInventory);

  return (
    <div className="space-y-6">
      {/* Cooking Buildings Grid */}
      <BlockCard
        icon="🍳"
        title="Kitchen Facilities & Oil Reserve"
        right={<Tag color="blue">{buildings.length} Facilities</Tag>}
      >
        {buildings.length === 0 ? (
          <div className="py-6 text-center text-xs text-[#888]">No cooking buildings found on farm.</div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
            {buildings.map((b) => {
              const hasOil = (b.oil ?? 0) > 0;
              const isReady = b.readyAt && b.readyAt <= Date.now();
              return (
                <div
                  key={b.name}
                  className="bg-black/[0.02] dark:bg-white/[0.02] border border-black/5 dark:border-white/5 rounded-xl p-3.5 flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-semibold text-xs text-[#1a1a1a] dark:text-white flex items-center gap-1.5">
                        <span>{BUILDING_ICONS[b.name] || "🍳"}</span>
                        <span>{b.name}</span>
                      </span>
                      {b.isBusy ? (
                        isReady ? <Tag color="green">Ready</Tag> : <Tag color="amber">Cooking</Tag>
                      ) : (
                        <Tag color="gray">Idle</Tag>
                      )}
                    </div>

                    {/* Oil Boost Status */}
                    <div className="flex items-center justify-between text-xs py-1.5 px-2 bg-black/[0.02] dark:bg-white/[0.03] rounded-lg font-mono mb-3">
                      <span className="text-[#888] flex items-center gap-1">🛢️ Oil: {b.oil ?? 0}</span>
                      {hasOil ? (
                        <span className="text-amber-600 dark:text-amber-400 font-semibold text-[10px]">{b.oilBoost || "+20% speed"}</span>
                      ) : (
                        <span className="text-[#888] text-[10px]">No Boost</span>
                      )}
                    </div>

                    {/* Active Crafting Queue */}
                    {b.crafting && b.crafting.length > 0 ? (
                      <div className="space-y-1.5">
                        {b.crafting.map((c, idx) => (
                          <div key={idx} className="flex items-center justify-between text-xs font-mono text-[#555] dark:text-[#aaa]">
                            <span className="truncate">{c.name} {c.amount > 1 ? `x${c.amount}` : ''}</span>
                            <span className="shrink-0 text-[11px] text-[#888]">
                              {c.readyAt <= Date.now() ? '✓ Ready' : new Date(c.readyAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[11px] text-[#888] italic py-1">Pot is currently idle.</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </BlockCard>

      {/* Optimal Cooking Strategy from Planner */}
      {plan?.buildings && plan.buildings.length > 0 && (
        <BlockCard
          icon="✨"
          title="Recommended Cooking Plan"
          right={<Tag color="green">Max XP Efficiency</Tag>}
        >
          <div className="grid md:grid-cols-2 gap-3">
            {plan.buildings.map((b) => (
              <div
                key={b.building}
                className="bg-black/[0.02] dark:bg-white/[0.02] border border-black/5 dark:border-white/5 rounded-xl p-3 flex flex-col justify-between"
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-mono text-[#888]">🏠 {b.building}</span>
                  <span className="text-xs font-bold text-amber-600 dark:text-amber-400">{b.recipe}</span>
                </div>
                <div className="grid grid-cols-3 gap-1.5 pt-2 border-t border-black/5 dark:border-white/5 text-center text-xs font-mono">
                  <div>
                    <div className="text-[9px] text-[#888]">XP</div>
                    <div className="font-semibold text-emerald-600 dark:text-emerald-400">+{fmtXp(b.batchXp)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-[#888]">FLOWER</div>
                    <div className="font-semibold text-amber-600 dark:text-amber-400">🌸 {fmtFlower(b.flowerCost)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] text-[#888]">TIME</div>
                    <div className="font-semibold text-[#555] dark:text-[#aaa]">⏱ {hrs(b.totalMinutes)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </BlockCard>
      )}

      {/* Food Storage / Prepared Meals in Inventory */}
      <BlockCard
        icon="🍲"
        title="Prepared Meals in Inventory"
        right={<Tag color="amber">{fmt(totalMeals)} dishes stored</Tag>}
      >
        {foodEntries.length === 0 ? (
          <div className="py-6 text-center text-xs text-[#888]">No cooked dishes in inventory.</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 font-mono text-xs">
            {foodEntries.map(([dish, qty]) => (
              <div
                key={dish}
                className="p-2 rounded-lg border border-black/5 dark:border-white/5 bg-black/[0.01] dark:bg-white/[0.02] flex items-center justify-between"
              >
                <span className="truncate text-[#37352f] dark:text-[#d4d4d4] font-sans">{dish}</span>
                <span className="font-bold text-amber-600 dark:text-amber-400 shrink-0 ml-1.5">{fmt(qty)}</span>
              </div>
            ))}
          </div>
        )}
      </BlockCard>
    </div>
  );
}

function CropsPanel({ data }) {
  const activeCrops = data?.activeCrops ?? [];
  const greenhouse = data?.greenhouse ?? { activeCount: 0, items: [] };
  const seeds = Object.entries(data?.seeds ?? {});
  const produce = Object.entries(data?.produce ?? {});
  const composters = data?.composters ?? [];

  return (
    <div className="space-y-6">
      {/* In-Ground Plots */}
      <BlockCard
        icon="🌱"
        title="In-Ground Crop Plots"
        right={<Tag color={activeCrops.length > 0 ? "green" : "gray"}>{activeCrops.length} Active Plots</Tag>}
      >
        {activeCrops.length === 0 ? (
          <div className="py-6 text-center text-xs text-[#888]">All dirt plots are currently clear. Plant seeds to start harvesting!</div>
        ) : (
          <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2.5">
            {activeCrops.map((c, idx) => (
              <div
                key={c.id || idx}
                className="p-2.5 rounded-lg border border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.02] flex items-center justify-between font-mono text-xs"
              >
                <div>
                  <div className="font-semibold text-[#1a1a1a] dark:text-white font-sans">{c.item}</div>
                  <div className="text-[10px] text-[#888]">Plot #{idx + 1}</div>
                </div>
                <div className="text-right">
                  <div className="text-emerald-600 dark:text-emerald-400 font-bold">+{c.expectedOutput || 1} yield</div>
                  <div className="text-[10px] text-[#888]">{c.isReady ? '✓ Ready' : (c.readyAt ? new Date(c.readyAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Growing')}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </BlockCard>

      {/* Greenhouse & Composters Row */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Greenhouse */}
        <BlockCard
          icon="🏡"
          title="Greenhouse Hydroponics"
          right={<Tag color="purple">{greenhouse.activeCount} Pots Active</Tag>}
        >
          {greenhouse.items.length === 0 ? (
            <div className="py-6 text-center text-xs text-[#888]">Greenhouse pots are idle.</div>
          ) : (
            <div className="space-y-2 font-mono text-xs">
              {greenhouse.items.map((g, idx) => (
                <div
                  key={idx}
                  className="p-2 rounded-lg border border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.02] flex items-center justify-between"
                >
                  <span className="font-sans font-medium text-[#1a1a1a] dark:text-white">{g.item}</span>
                  <span className="text-[10px] text-[#888]">
                    {g.readyAt <= Date.now() ? '✓ Ready' : new Date(g.readyAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </BlockCard>

        {/* Composters */}
        <BlockCard
          icon="🪱"
          title="Composters & Soil Nutrition"
          right={<Tag color="brown">{composters.length} Installed</Tag>}
        >
          {composters.length === 0 ? (
            <div className="py-6 text-center text-xs text-[#888]">No composters built yet.</div>
          ) : (
            <div className="space-y-2 font-mono text-xs">
              {composters.map((comp) => (
                <div
                  key={comp.name}
                  className="p-2 rounded-lg border border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.02] flex items-center justify-between"
                >
                  <div>
                    <div className="font-sans font-medium text-[#1a1a1a] dark:text-white">{comp.name}</div>
                    {comp.oil != null && <div className="text-[10px] text-[#888]">Oil: {comp.oil}</div>}
                  </div>
                  <div>
                    {comp.isReady ? <Tag color="green">Ready</Tag> : (comp.readyAt ? <Tag color="amber">Composting</Tag> : <Tag color="gray">Idle</Tag>)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </BlockCard>
      </div>

      {/* Seed Stock */}
      <BlockCard
        icon="🌰"
        title="Seed Stash"
        right={<Tag color="gray">{seeds.length} varieties</Tag>}
      >
        {seeds.length === 0 ? (
          <div className="py-4 text-center text-xs text-[#888]">No seeds in inventory. Buy some from the Market!</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 font-mono text-xs">
            {seeds.map(([seed, qty]) => (
              <div
                key={seed}
                className="p-2 rounded-lg border border-black/5 dark:border-white/5 bg-black/[0.01] dark:bg-white/[0.02] flex items-center justify-between"
              >
                <span className="truncate text-[#37352f] dark:text-[#d4d4d4] font-sans">{seed.replace(" Seed", "")}</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400 shrink-0 ml-1">{fmt(qty)}</span>
              </div>
            ))}
          </div>
        )}
      </BlockCard>

      {/* Harvested Produce Inventory */}
      <BlockCard
        icon="🌽"
        title="Harvested Produce Warehouse"
        right={<Tag color="green">{produce.length} crops stored</Tag>}
      >
        {produce.length === 0 ? (
          <div className="py-4 text-center text-xs text-[#888]">No harvested crops in inventory.</div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 font-mono text-xs">
            {produce.map(([item, qty]) => (
              <div
                key={item}
                className="p-2 rounded-lg border border-black/5 dark:border-white/5 bg-black/[0.01] dark:bg-white/[0.02] flex items-center justify-between"
              >
                <span className="truncate text-[#37352f] dark:text-[#d4d4d4] font-sans">{item}</span>
                <span className="font-bold text-[#1a1a1a] dark:text-white shrink-0 ml-1">{fmt(qty)}</span>
              </div>
            ))}
          </div>
        )}
      </BlockCard>
    </div>
  );
}

function AnimalsPanel({ data }) {
  const henHouse = data?.henHouse ?? { chickensCount: 0, eggsInStock: 0, eggStock: 0, specialChickens: {} };
  const barn = data?.barn ?? { cowsCount: 0, sheepCount: 0, milkStock: 0, woolStock: 0, merinoWoolStock: 0, leatherStock: 0, featherStock: 0 };
  const feedEntries = Object.entries(data?.feedInventory ?? {});
  const careEntries = Object.entries(data?.careEquipment ?? {});
  const eggStock = henHouse.eggsInStock ?? henHouse.eggStock ?? 0;
  const specialList = Array.isArray(henHouse.specialChickens)
    ? henHouse.specialChickens
    : Object.entries(henHouse.specialChickens || {}).map(([name, count]) => ({ name, buff: `x${count} Active` }));

  return (
    <div className="space-y-6">
      {/* Animals Quick Summary Cards */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Hen House */}
        <BlockCard
          icon="🐔"
          title="Hen House & Poultry"
          right={<Tag color="amber">{henHouse.chickensCount} Chickens</Tag>}
        >
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-black/[0.02] dark:bg-white/[0.02] border border-black/5 dark:border-white/5 rounded-xl">
              <div>
                <div className="text-xs font-semibold text-[#1a1a1a] dark:text-white">Egg Production</div>
                <div className="text-[11px] text-[#888]">Current egg inventory</div>
              </div>
              <div className="text-xl font-bold font-mono text-amber-600 dark:text-amber-400">
                🥚 {fmt(eggStock)}
              </div>
            </div>

            {specialList.length > 0 && (
              <div>
                <div className="text-[11px] font-semibold text-[#888] uppercase tracking-wider mb-1.5 font-mono">Special Poultry Boosts</div>
                <div className="space-y-1.5">
                  {specialList.map((sc, idx) => (
                    <div key={idx} className="p-2 rounded-lg border border-black/5 dark:border-white/5 bg-black/[0.01] dark:bg-white/[0.02] flex items-center justify-between text-xs">
                      <span className="font-semibold text-[#1a1a1a] dark:text-white">⭐ {sc.name}</span>
                      <span className="text-[11px] text-amber-600 dark:text-amber-400 font-mono">{sc.buff}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </BlockCard>

        {/* Barn & Pasture */}
        <BlockCard
          icon="🐄"
          title="Barn & Pasture"
          right={<Tag color="blue">{barn.cowsCount} Cows · {barn.sheepCount} Sheep</Tag>}
        >
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono text-xs">
            <div className="p-2.5 rounded-lg border border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.02]">
              <div className="text-[10px] text-[#888] font-sans">🥛 Milk</div>
              <div className="text-base font-bold text-[#1a1a1a] dark:text-white">{fmt(barn.milkStock)}</div>
            </div>
            <div className="p-2.5 rounded-lg border border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.02]">
              <div className="text-[10px] text-[#888] font-sans">🧶 Wool</div>
              <div className="text-base font-bold text-[#1a1a1a] dark:text-white">{fmt(barn.woolStock)}</div>
            </div>
            <div className="p-2.5 rounded-lg border border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.02]">
              <div className="text-[10px] text-[#888] font-sans">🐑 Merino Wool</div>
              <div className="text-base font-bold text-[#1a1a1a] dark:text-white">{fmt(barn.merinoWoolStock)}</div>
            </div>
            <div className="p-2.5 rounded-lg border border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.02]">
              <div className="text-[10px] text-[#888] font-sans">🥾 Leather</div>
              <div className="text-base font-bold text-[#1a1a1a] dark:text-white">{fmt(barn.leatherStock)}</div>
            </div>
            <div className="p-2.5 rounded-lg border border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.02]">
              <div className="text-[10px] text-[#888] font-sans">🪶 Feathers</div>
              <div className="text-base font-bold text-[#1a1a1a] dark:text-white">{fmt(barn.featherStock)}</div>
            </div>
          </div>
        </BlockCard>
      </div>

      {/* Livestock Feed & Care Row */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Feed Stock */}
        <BlockCard
          icon="🌾"
          title="Animal Feed & Grains"
          right={<Tag color="yellow">{feedEntries.length} items</Tag>}
        >
          {feedEntries.length === 0 ? (
            <div className="py-4 text-center text-xs text-[#888]">No grains or feed in stock.</div>
          ) : (
            <div className="grid grid-cols-2 gap-2 font-mono text-xs">
              {feedEntries.map(([feed, qty]) => (
                <div key={feed} className="p-2 rounded-lg border border-black/5 dark:border-white/5 bg-black/[0.01] dark:bg-white/[0.02] flex items-center justify-between">
                  <span className="font-sans text-[#37352f] dark:text-[#d4d4d4]">{feed}</span>
                  <span className="font-bold text-amber-600 dark:text-amber-400">{fmt(qty)}</span>
                </div>
              ))}
            </div>
          )}
        </BlockCard>

        {/* Care Equipment */}
        <BlockCard
          icon="🧼"
          title="Grooming & Care Gear"
          right={<Tag color="gray">{careEntries.length} tools</Tag>}
        >
          {careEntries.length === 0 ? (
            <div className="py-4 text-center text-xs text-[#888]">No animal care equipment in inventory.</div>
          ) : (
            <div className="grid grid-cols-2 gap-2 font-mono text-xs">
              {careEntries.map(([gear, qty]) => (
                <div key={gear} className="p-2 rounded-lg border border-black/5 dark:border-white/5 bg-black/[0.01] dark:bg-white/[0.02] flex items-center justify-between">
                  <span className="font-sans text-[#37352f] dark:text-[#d4d4d4]">{gear}</span>
                  <span className="font-semibold text-[#1a1a1a] dark:text-white">{fmt(qty)}</span>
                </div>
              ))}
            </div>
          )}
        </BlockCard>
      </div>
    </div>
  );
}

function ResourcesPanel({ data }) {
  const primary = data?.primary ?? {};
  const tools = Object.entries(data?.tools ?? {});
  const nodes = Object.entries(data?.nodes ?? {});

  const resourceIcons = {
    Wood: "🪵",
    Stone: "🪨",
    Iron: "⛏️",
    Gold: "🪙",
    Crimstone: "🔴",
    Sunstone: "☀️",
    Obsidian: "🖤",
    Oil: "🛢️",
  };

  return (
    <div className="space-y-6">
      {/* Primary Raw Materials Vault */}
      <BlockCard
        icon="💎"
        title="Primary Raw Materials Vault"
        right={<Tag color="blue">Deterministic Balances</Tag>}
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Object.entries(resourceIcons).map(([res, icon]) => (
            <div
              key={res}
              className="p-3 rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-[#202020] hover:border-amber-500/30 transition-all shadow-xs"
            >
              <div className="flex items-center gap-1.5 text-xs text-[#888] mb-1">
                <span>{icon}</span>
                <span className="font-medium text-[#37352f] dark:text-[#d4d4d4]">{res}</span>
              </div>
              <div className="text-xl font-bold font-mono text-[#1a1a1a] dark:text-white truncate">
                {fmt(primary[res.toLowerCase()] ?? primary[res] ?? 0)}
              </div>
            </div>
          ))}
        </div>
      </BlockCard>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Island Resource Nodes */}
        <BlockCard
          icon="🗺️"
          title="Island Natural Harvest Nodes"
          right={<Tag color="green">{nodes.length} node types</Tag>}
        >
          {nodes.length === 0 ? (
            <div className="py-6 text-center text-xs text-[#888]">No resource node mapping available.</div>
          ) : (
            <div className="grid grid-cols-2 gap-2 font-mono text-xs">
              {nodes.map(([node, count]) => (
                <div key={node} className="p-2.5 rounded-lg border border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.02] flex items-center justify-between">
                  <span className="font-sans text-[#37352f] dark:text-[#d4d4d4] truncate">{node}</span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400 shrink-0 ml-1">{count}</span>
                </div>
              ))}
            </div>
          )}
        </BlockCard>

        {/* Toolshed Equipment */}
        <BlockCard
          icon="🛠️"
          title="Toolshed Equipment"
          right={<Tag color="amber">{tools.length} tool types</Tag>}
        >
          {tools.length === 0 ? (
            <div className="py-6 text-center text-xs text-[#888]">No gathering tools currently in inventory.</div>
          ) : (
            <div className="grid grid-cols-2 gap-2 font-mono text-xs">
              {tools.map(([tool, qty]) => (
                <div key={tool} className="p-2.5 rounded-lg border border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.02] flex items-center justify-between">
                  <span className="font-sans text-[#37352f] dark:text-[#d4d4d4] truncate">{tool}</span>
                  <span className="font-semibold text-[#1a1a1a] dark:text-white shrink-0 ml-1">{fmt(qty)}</span>
                </div>
              ))}
            </div>
          )}
        </BlockCard>
      </div>
    </div>
  );
}

function EffectsPanel({ data }) {
  const collectibles = data?.placedCollectibles ?? [];
  const skills = data?.skills ?? [];
  const wearables = Object.entries(data?.wearables ?? {});
  const vip = data?.vip ?? { active: false, boosts: [] };
  const diag = data?.diagnostics ?? { rawHash: null, stale: false };

  return (
    <div className="space-y-6">
      {/* Placed Collectibles & Landmarks */}
      <BlockCard
        icon="⚡"
        title="Placed Collectibles & Active Boost Items"
        right={<Tag color="amber">{collectibles.length} Placed</Tag>}
      >
        {collectibles.length === 0 ? (
          <div className="py-6 text-center text-xs text-[#888]">No collectibles placed on farm terrain.</div>
        ) : (
          <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 font-mono text-xs">
            {collectibles.map((col, idx) => (
              <div
                key={idx}
                className="p-2 rounded-lg border border-black/5 dark:border-white/5 bg-black/[0.01] dark:bg-white/[0.02] flex items-center justify-between"
              >
                <span className="truncate font-sans font-medium text-[#1a1a1a] dark:text-white">{col.name}</span>
                <span className="text-[10px] text-[#888] shrink-0 ml-1">
                  ({col.coordinates?.x ?? 0}, {col.coordinates?.y ?? 0})
                </span>
              </div>
            ))}
          </div>
        )}
      </BlockCard>

      {/* Bumpkin Skills & Wearables Row */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* Unlocked Bumpkin Skills */}
        <BlockCard
          icon="🎓"
          title="Bumpkin Skill Tree Unlocks"
          right={<Tag color="purple">{skills.length} Masteries</Tag>}
        >
          {skills.length === 0 ? (
            <div className="py-6 text-center text-xs text-[#888]">No Bumpkin skills unlocked yet.</div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {skills.map((s, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-black/10 dark:border-white/10 bg-black/[0.02] dark:bg-white/[0.02]"
                >
                  <span className="font-semibold text-[#1a1a1a] dark:text-white">{s.name}</span>
                  <span className="text-[10px] font-mono text-purple-600 dark:text-purple-400 font-bold">T{s.tier}</span>
                </span>
              ))}
            </div>
          )}
        </BlockCard>

        {/* Equipped Wearables */}
        <BlockCard
          icon="👕"
          title="Equipped Wearables"
          right={<Tag color="blue">{wearables.length} Items</Tag>}
        >
          {wearables.length === 0 ? (
            <div className="py-6 text-center text-xs text-[#888]">No wearables equipped.</div>
          ) : (
            <div className="grid grid-cols-2 gap-2 font-mono text-xs">
              {wearables.map(([slot, item]) => (
                <div key={slot} className="p-2 rounded-lg border border-black/5 dark:border-white/5 bg-black/[0.01] dark:bg-white/[0.02] flex items-center justify-between">
                  <span className="text-[10px] text-[#888] uppercase truncate">{slot}</span>
                  <span className="font-sans font-medium text-[#1a1a1a] dark:text-white truncate ml-1">{item}</span>
                </div>
              ))}
            </div>
          )}
        </BlockCard>
      </div>

      {/* VIP & State Integrity Row */}
      <div className="grid md:grid-cols-2 gap-4">
        {/* VIP & Active Boosts */}
        <BlockCard
          icon="👑"
          title="VIP Membership & Active Buffs"
          right={vip.active ? <Tag color="amber">VIP Active</Tag> : <Tag color="gray">Standard</Tag>}
        >
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs py-1">
              <span className="text-[#888]">Status</span>
              <span className="font-semibold text-[#1a1a1a] dark:text-white">{vip.active ? "🌟 VIP Member" : "Standard Account"}</span>
            </div>
            {vip.boosts && vip.boosts.length > 0 && (
              <div className="pt-2 border-t border-black/5 dark:border-white/5">
                <div className="text-[10px] uppercase font-mono text-[#888] mb-1">Active Boosts</div>
                <div className="flex flex-wrap gap-1">
                  {vip.boosts.map((b, idx) => (
                    <Tag key={idx} color="green">{b}</Tag>
                  ))}
                </div>
              </div>
            )}
          </div>
        </BlockCard>

        {/* Diagnostics & State Hash */}
        <BlockCard
          icon="🔒"
          title="Deterministic State Integrity"
          right={diag.stale ? <Tag color="amber">Cached</Tag> : <Tag color="green">Verified Live</Tag>}
        >
          <div className="space-y-2 font-mono text-xs">
            <div>
              <div className="text-[10px] text-[#888] uppercase mb-0.5">Raw SHA-256 Hash</div>
              <div className="text-[11px] p-1.5 bg-black/[0.03] dark:bg-white/[0.03] rounded border border-black/5 dark:border-white/5 truncate select-all text-[#37352f] dark:text-[#d4d4d4]">
                {diag.rawHash || "—"}
              </div>
            </div>
            <div className="flex items-center justify-between text-[11px] text-[#888] pt-1">
              <span>Cache Freshness</span>
              <span className={diag.stale ? "text-amber-600" : "text-emerald-600"}>
                {diag.stale ? "⚠️ Snapshot Stale" : "✓ Synchronized"}
              </span>
            </div>
          </div>
        </BlockCard>
      </div>
    </div>
  );
}

function Dashboard({ farm, plan }) {
  if (!farm) return <div className="py-12 text-center text-sm text-[#888] animate-pulse">🌾 Accessing farm data from Sunflower Land...</div>;

  const [activeCategory, setActiveCategory] = useState("overview");

  const dashboardData = {
    overview: selectOverviewData(farm, plan),
    cooking: selectCookingData(farm, plan),
    crops: selectCropData(farm),
    animals: selectAnimalData(farm),
    resources: selectResourceData(farm),
    effects: selectEffectData(farm),
  };

  const kpis = dashboardData.overview.kpis || {
    level: farm.bumpkin?.level || 1,
    xp: farm.bumpkin?.xp || 0,
    targetXp: farm.target?.xp || 24_083_905,
    remainingXp: farm.target?.remaining || 24_083_905,
    flowerApprox: farm.currencies?.flowerApprox || 0,
    coins: farm.currencies?.coins || 0,
  };

  const counts = {
    cooking: dashboardData.cooking.buildings.length,
    crops: dashboardData.crops.activeCrops.length + dashboardData.crops.greenhouse.activeCount,
    animals: (dashboardData.animals.henHouse.chickensCount || 0) + (dashboardData.animals.barn.cowsCount || 0) + (dashboardData.animals.barn.sheepCount || 0),
    resources: Object.keys(dashboardData.resources.primary).length,
    effects: dashboardData.effects.placedCollectiblesCount,
  };

  return (
    <div className="space-y-6">
      {/* Top 4 Metrics - Preserved outside category switch so farm's primary status is NEVER lost */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricStat icon="🧑‍🌾" label="Bumpkin Level" value={`Lv ${kpis.level}`} sub="Active Explorer" />
        <MetricStat icon="⭐" label="Experience Points" value={fmt(kpis.xp)} sub={`${fmt(kpis.remainingXp)} to Lv 100`} />
        <MetricStat icon="🌸" label="FLOWER" value={Number(kpis.flowerApprox).toFixed(2)} sub="approx treasury" />
        <MetricStat icon="🪙" label="Gold Coins" value={fmt(kpis.coins)} sub="available" />
      </div>

      {/* Category Tabs */}
      <CategoryTabs
        activeCategory={activeCategory}
        onChange={setActiveCategory}
        counts={counts}
      />

      {/* Selected Category Sub-panel */}
      {activeCategory === "overview" && <OverviewPanel data={dashboardData.overview} farm={farm} plan={plan} />}
      {activeCategory === "cooking" && <CookingPanel data={dashboardData.cooking} plan={plan} />}
      {activeCategory === "crops" && <CropsPanel data={dashboardData.crops} />}
      {activeCategory === "animals" && <AnimalsPanel data={dashboardData.animals} />}
      {activeCategory === "resources" && <ResourcesPanel data={dashboardData.resources} />}
      {activeCategory === "effects" && <EffectsPanel data={dashboardData.effects} />}
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

function formatCountdown(ms) {
  if (ms <= 0) return "0s";
  const totalSecs = Math.floor(ms / 1000);
  const hours = Math.floor(totalSecs / 3600);
  const minutes = Math.floor((totalSecs % 3600) / 60);
  const seconds = totalSecs % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

const COOKING_FACILITY_ORDER = ['Fire Pit', 'Kitchen', 'Bakery', 'Smoothie Shack', 'Deli'];

function CookingPage({ recipesData, farm }) {
  const [filter, setFilter] = useState("all"); // all | ready | missing
  const [activeBuilding, setActiveBuilding] = useState(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const cookingData = useMemo(() => selectCookingData(farm), [farm]);

  const facilityStates = useMemo(() => {
    return COOKING_FACILITY_ORDER.map((name) => {
      const bld = cookingData.buildings.find((b) => b.name === name);
      const isBuilt = Boolean(bld || farm?.buildings?.[name]);
      const activeCraft = bld?.crafting?.[0];
      const readyAt = activeCraft?.readyAt ?? bld?.readyAt ?? null;
      const isBusy = Boolean((readyAt && readyAt > now) || (activeCraft && (!readyAt || readyAt > now)));
      const itemName = activeCraft?.name ?? (isBusy ? "Cooking" : null);
      const amount = activeCraft?.amount ?? 1;
      const oil = bld?.oil ?? 0;
      const oilBoost = bld?.oilBoost ?? (oil > 0 ? '+20% Speed' : 'Base Speed');

      let remainingMs = 0;
      let isReady = false;
      if (readyAt) {
        remainingMs = Math.max(0, readyAt - now);
        isReady = readyAt <= now;
      }

      return {
        name,
        icon: BUILDING_ICONS[name] ?? "🍳",
        isBuilt,
        isBusy,
        isReady,
        itemName,
        amount,
        readyAt,
        remainingMs,
        oil,
        oilBoost,
      };
    });
  }, [cookingData, farm, now]);

  if (!recipesData) return (
    <div className="py-12 text-center text-sm text-[#888] animate-pulse">🍳 Loading cooking facilities and recipe catalogue...</div>
  );
  if (recipesData.error) return <Callout icon="❌" type="danger" title="Recipe Error">{recipesData.error}</Callout>;

  const buildings = Object.keys(recipesData.byBuilding ?? {});
  const activeBld = activeBuilding ?? buildings[0] ?? COOKING_FACILITY_ORDER[0];
  const allForBuilding = recipesData.byBuilding?.[activeBld] ?? [];

  const filtered = allForBuilding.filter((r) => {
    if (filter === "ready") return r.canCook;
    if (filter === "missing") return !r.canCook;
    return true;
  });

  const readyCount = allForBuilding.filter((r) => r.canCook).length;
  const totalCount = allForBuilding.length;

  return (
    <div className="space-y-6">
      {/* ─── 1. Live Kitchen Operations ──────────────────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm">🔥</span>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#787774] dark:text-[#888]">
              Live Kitchen Operations
            </h2>
          </div>
          <span className="text-[11px] font-mono text-[#888]">
            {facilityStates.filter((f) => f.isBusy).length} of {facilityStates.length} Active
          </span>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {facilityStates.map((facility) => {
            const isCooking = facility.isBusy && facility.itemName;
            const isReady = facility.isReady;

            return (
              <div
                key={facility.name}
                onClick={() => setActiveBuilding(facility.name)}
                className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                  activeBld === facility.name
                    ? "bg-amber-500/10 border-amber-500/40 shadow-sm"
                    : "bg-white dark:bg-[#202020] border-black/10 dark:border-white/10 hover:border-black/20 dark:hover:border-white/20"
                }`}
              >
                {/* Facility Header */}
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-1.5">
                    <span className="text-base">{facility.icon}</span>
                    <span className="font-semibold text-xs text-[#1a1a1a] dark:text-white font-display">
                      {facility.name}
                    </span>
                  </div>
                  {isCooking ? (
                    isReady ? (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 animate-pulse">
                        ✓ Ready to Collect
                      </span>
                    ) : (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30">
                        🔥 Cooking
                      </span>
                    )
                  ) : (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-mono text-[#888] bg-black/5 dark:bg-white/5">
                      Idle
                    </span>
                  )}
                </div>

                {/* Body: Cooking Item or Idle */}
                {isCooking ? (
                  <div className="space-y-2 mt-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-[#1a1a1a] dark:text-white truncate">
                        {facility.itemName}
                      </span>
                      {facility.amount > 1 && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300">
                          {facility.amount}x
                        </span>
                      )}
                    </div>

                    {/* Progress Bar */}
                    <div className="w-full bg-black/10 dark:bg-white/10 rounded-full h-1.5 overflow-hidden">
                      <div
                        className={`h-full transition-all duration-500 ${
                          isReady ? "bg-emerald-500" : "bg-amber-500"
                        }`}
                        style={{ width: isReady ? "100%" : "68%" }}
                      />
                    </div>

                    <div className="flex items-center justify-between text-[10px] font-mono text-[#888]">
                      <span>
                        {isReady ? "Completed" : `Ready in ${formatCountdown(facility.remainingMs)}`}
                      </span>
                      {facility.oil > 0 ? (
                        <span className="text-amber-600 dark:text-amber-400">
                          🛢️ +20% Oil ({facility.oil})
                        </span>
                      ) : (
                        <span>Base Speed</span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="py-2 text-[11px] font-mono text-[#888] flex items-center justify-between">
                    <span>Ready to cook recipes</span>
                    <span className="text-[10px]">
                      {facility.oil > 0 ? `🛢️ ${facility.oil} Oil` : "No Oil"}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="w-full h-px bg-black/10 dark:bg-white/10 my-4" />

      {/* ─── 2. Recipe Catalogue Section ─────────────────────────────── */}
      <div className="space-y-4">
        {/* Header Summary Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-[#202020] p-4 rounded-xl border border-black/10 dark:border-white/10 shadow-sm">
          <div>
            <div className="text-xs text-[#888] font-mono uppercase">Recipe Catalogue</div>
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
                  <span className="font-mono text-[10px] bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded-full">
                    {bldReady}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Recipe Grid */}
        {filtered.length === 0 ? (
          <div className="py-12 text-center text-sm text-[#888] font-mono">
            No recipes match your filter.
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 items-start">
            {filtered.map((recipe) => (
              <RecipeCard key={recipe.name} r={recipe} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function fmtNum(n) {
  if (n == null || isNaN(n)) return "0";
  const num = Number(n);
  if (num >= 1_000_000) {
    return `${(num / 1_000_000).toFixed(1)}M`;
  }
  if (Number.isInteger(num)) {
    return num.toLocaleString();
  }
  const rounded = Math.round(num * 100) / 100;
  return rounded.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function ProcessingJobCard({ job }) {
  const [expanded, setExpanded] = useState(false);
  const ready = job.sufficient;
  const inBag = job.inBag ?? 0;
  const primeInBag = job.primeInBag ?? 0;
  const primaryOutput = job.outputs?.[0];
  const missingEntries = job.ingredients?.filter((i) => !i.sufficient) ?? [];
  const facilityLabel = job.facility;
  const seasonBadge = job.currentSeason ? (
    job.currentSeason === 'SPRING' ? '🌸 Spring' :
    job.currentSeason === 'SUMMER' ? '☀️ Summer' :
    job.currentSeason === 'AUTUMN' ? '🍁 Autumn' : '❄️ Winter'
  ) : null;

  return (
    <div
      onClick={() => setExpanded(!expanded)}
      className={`p-3.5 rounded-xl border transition-all cursor-pointer select-none ${
        expanded
          ? "bg-white dark:bg-[#202020] border-amber-500/50 shadow-md ring-1 ring-amber-500/20"
          : "bg-white dark:bg-[#202020] border-black/10 dark:border-white/10 hover:border-black/20 dark:hover:border-white/20 shadow-sm"
      }`}
    >
      {/* Card Header: 2-Row Layout with Level Alignment */}
      <div className="mb-2.5">
        {/* Row 1: Title & Icon on Left, Inventory & Status Badges on Right */}
        <div className="flex items-center justify-between gap-2 min-h-[26px]">
          <div className="flex items-center gap-1.5 min-w-0">
            <span className="text-base shrink-0">{job.icon}</span>
            <span className="font-bold text-[13px] text-[#1a1a1a] dark:text-white truncate" title={job.name}>
              {job.name}
            </span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {inBag > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] font-mono font-medium px-2 py-0.5 rounded bg-sky-500/15 border border-sky-500/30 text-sky-700 dark:text-sky-300 whitespace-nowrap" title="In player inventory">
                📦 ×{fmtNum(inBag)}
              </span>
            )}
            {primeInBag > 0 && (
              <span className="inline-flex items-center gap-1 text-[10px] font-mono font-medium px-2 py-0.5 rounded bg-purple-500/15 border border-purple-500/30 text-purple-700 dark:text-purple-300 whitespace-nowrap" title="Prime catch in inventory">
                ✨ ×{fmtNum(primeInBag)}
              </span>
            )}
            {ready ? (
              <span className="inline-flex items-center gap-1 text-[10px] font-mono font-semibold px-2 py-0.5 rounded border bg-emerald-500/20 border-emerald-500/40 text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                ✓ Ready
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[10px] font-mono font-medium px-2 py-0.5 rounded border bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 text-[#888] whitespace-nowrap">
                Missing
              </span>
            )}
          </div>
        </div>

        {/* Row 2: Facility · Sub-Rack · Season · Boosts */}
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-[#888] mt-1.5 flex-wrap min-h-[22px]">
          <span>{facilityLabel}</span>
          {job.rack && (
            <span className={`px-1.5 py-0.5 rounded font-semibold border ${
              job.rack === "AGING"
                ? "bg-indigo-500/15 border-indigo-500/30 text-indigo-700 dark:text-indigo-400"
                : job.rack === "FERMENTATION"
                ? "bg-emerald-500/15 border-emerald-500/30 text-emerald-700 dark:text-emerald-400"
                : "bg-amber-500/15 border-amber-500/30 text-amber-700 dark:text-amber-400"
            }`}>
              {job.rack === "AGING" ? "Aging Rack" : job.rack === "FERMENTATION" ? "Fermentation" : "Spice Rack"}
            </span>
          )}
          {Boolean(job.ingredientsBySeason) && (
            <span className="px-1.5 py-0.5 rounded bg-sky-500/15 border border-sky-500/30 text-sky-700 dark:text-sky-400 font-semibold whitespace-nowrap">
              {seasonBadge}
            </span>
          )}
          {Boolean(job.isSpeedyAgingActive) && (
            <span className="px-1.5 py-0.5 rounded bg-blue-500/15 border border-blue-500/30 text-blue-700 dark:text-blue-300 font-semibold whitespace-nowrap" title="-10% Aging Time Active">
              ⚡ Speedy Aging
            </span>
          )}
          {Boolean(job.isFishSmokingActive) && (
            <span className="px-1.5 py-0.5 rounded bg-purple-500/15 border border-purple-500/30 text-purple-700 dark:text-purple-300 font-semibold whitespace-nowrap" title="2× Prime Aged Chance Active">
              ⚡ Fish Smoking
            </span>
          )}
          {Boolean(job.isBacalhauActive) && (
            <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-700 dark:text-emerald-300 font-semibold whitespace-nowrap" title="+1 Yield Active">
              ⚡ Bacalhau
            </span>
          )}
          {Boolean(job.isRefinerActive) && (
            <span className="px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-700 dark:text-amber-300 font-semibold whitespace-nowrap" title="15% Bonus Output Chance Active">
              ⚡ Refiner
            </span>
          )}
          {Boolean(job.isRuntimeObserved) && (
            <span className="px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/30 text-amber-700 dark:text-amber-400 font-semibold whitespace-nowrap">
              ⚡ Observed
            </span>
          )}
        </div>
      </div>

      {/* Recipe Requirements & Output Strip */}
      <div className="mb-2.5 p-2 rounded-lg bg-black/[0.025] dark:bg-white/[0.03] border border-black/5 dark:border-white/5 text-[11px] font-mono">
        <div className="flex items-center justify-between text-[9px] uppercase font-semibold text-[#888] mb-1.5">
          <span>Requires ({job.inputs.length} {job.inputs.length === 1 ? "item" : "items"})</span>
          <span className="text-amber-600 dark:text-amber-400 font-bold whitespace-nowrap">
            ➔ {primaryOutput?.amount ?? 1}× {primaryOutput?.item ?? job.name}
          </span>
        </div>
        <div className="flex flex-wrap gap-1">
          {job.inputs.map((inp, idx) => (
            <span
              key={idx}
              className="px-1.5 py-0.5 rounded bg-white dark:bg-[#252525] border border-black/5 dark:border-white/10 text-[10px] text-[#444] dark:text-[#ccc] font-medium inline-flex items-center gap-1 whitespace-nowrap"
            >
              <span className="text-[#888]">{inp.required}×</span>
              <span className="text-[#1a1a1a] dark:text-white font-semibold">{inp.item}</span>
            </span>
          ))}
        </div>
      </div>

      {/* Special Effect Banner (Fermentation / Spice boosts) */}
      {job.effectBadge && (
        <div className="mb-2 px-2 py-1 rounded bg-emerald-500/10 border border-emerald-500/20 text-[10px] font-mono text-emerald-700 dark:text-emerald-300 flex items-start gap-1.5">
          <span className="shrink-0 font-bold">✨ Effect:</span>
          <span className="font-medium leading-snug">{job.effectBadge}</span>
        </div>
      )}

      {/* Boosts applied panel (matching in-game Sunflower Land) */}
      {job.appliedBoosts?.length > 0 && (
        <div className="mb-2.5 p-2 rounded-lg bg-amber-500/[0.08] dark:bg-amber-500/[0.12] border border-amber-500/25 text-[11px] font-mono">
          <div className="flex items-center justify-between font-semibold text-amber-900 dark:text-amber-200 mb-1">
            <span className="flex items-center gap-1.5">
              <span className="text-amber-500 text-xs">⚡</span>
              <span>Boosts applied:</span>
            </span>
            {job.foodXpMultiplier > 1 && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-800 dark:text-amber-300 border border-amber-500/30">
                XP ×{job.foodXpMultiplier.toFixed(4)}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1 text-[10px] text-amber-800 dark:text-amber-300 pt-1 border-t border-amber-500/15">
            {job.appliedBoosts.map((b, idx) => (
              <span key={idx} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-500/15 border border-amber-500/25">
                <span className="text-xs">{b.icon}</span>
                <span>{b.label}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Stats Row */}
      <div className="grid grid-cols-4 gap-1.5 text-center font-mono">
        <div className="bg-black/[0.03] dark:bg-white/[0.04] p-1.5 rounded-lg flex flex-col justify-center min-h-[48px] overflow-hidden">
          <div className="text-[9px] text-[#888] uppercase tracking-wider mb-0.5">XP</div>
          <div className="text-[11px] font-bold leading-tight">
            {job.isXpBoosted && job.boostedBaseXp > 0 ? (
              <span className="text-emerald-600 dark:text-emerald-400">+{fmtXp(job.boostedBaseXp)}</span>
            ) : job.baseXp > 0 ? (
              <span className="text-emerald-600 dark:text-emerald-400">+{fmtXp(job.baseXp)}</span>
            ) : (
              <span className="text-[#888] dark:text-[#666] font-normal text-[11px]">None</span>
            )}
          </div>
          {job.isXpBoosted && job.baseXp > 0 && (
            <div className="text-[9px] text-[#888] line-through leading-none mt-0.5">
              +{fmtXp(job.baseXp)}
            </div>
          )}
        </div>
        <div className="bg-black/[0.03] dark:bg-white/[0.04] p-1.5 rounded-lg flex flex-col justify-center min-h-[48px] overflow-hidden">
          <div className="text-[9px] text-[#888] uppercase tracking-wider mb-0.5">Duration</div>
          <div className="text-[11px] font-bold text-[#444] dark:text-[#ccc] leading-tight">
            {hrs(job.durationMinutes)}
          </div>
          {job.isSpeedyAgingActive && job.baseDurationMinutes && job.baseDurationMinutes !== job.durationMinutes && (
            <div className="text-[9px] text-[#888] line-through leading-none mt-0.5">
              {hrs(job.baseDurationMinutes)}
            </div>
          )}
        </div>
        <div className="bg-black/[0.03] dark:bg-white/[0.04] p-1.5 rounded-lg flex flex-col justify-center min-h-[48px] overflow-hidden">
          <div className="text-[9px] text-[#888] uppercase tracking-wider mb-0.5">Output</div>
          <div className="text-[11px] font-bold text-amber-600 dark:text-amber-400 leading-tight">
            {job.isBacalhauActive ? (
              <span>
                +{primaryOutput?.amount ?? 1}{" "}
                <span className="text-[9px] text-emerald-600 font-normal">(+1)</span>
              </span>
            ) : (
              `${primaryOutput?.amount ?? 1}×`
            )}
          </div>
          {job.isAgerActive && (
            <div className="text-[8px] text-purple-600 dark:text-purple-400 font-semibold leading-none mt-0.5">
              2× Ager
            </div>
          )}
        </div>
        <div className="bg-black/[0.03] dark:bg-white/[0.04] p-1.5 rounded-lg flex flex-col justify-center min-h-[48px] overflow-hidden">
          <div className="text-[9px] text-[#888] uppercase tracking-wider mb-0.5">Instant</div>
          <div className="text-[11px] font-bold text-purple-600 dark:text-purple-400 leading-tight">
            💎 {job.gemCost}
          </div>
          <div className="text-[8px] text-[#888] leading-none mt-0.5">Skip</div>
        </div>
      </div>

      {/* Prime Output Banner (if applicable for Fish Aging) */}
      {job.primeXp > 0 && (
        <div className="mt-2 px-2.5 py-1 rounded-lg bg-purple-500/10 dark:bg-purple-500/15 border border-purple-500/25 flex items-center justify-between text-[10px] font-mono">
          <div className="flex items-center gap-1.5 text-purple-700 dark:text-purple-300 font-medium">
            <span>✨</span>
            <span className="font-semibold">{job.outputs?.[0]?.primeItem ?? "Prime Aged"}</span>
            <span className="text-[#888] dark:text-[#aaa]">({Math.round((job.primeChance ?? 0.1) * 100)}% chance)</span>
          </div>
          <div className="flex items-center gap-1 text-purple-700 dark:text-purple-300 font-bold">
            <span>+{fmtXp(job.boostedPrimeXp || job.primeXp)} XP</span>
            {job.isXpBoosted && (
              <span className="text-[9px] text-[#888] line-through font-normal">+{fmtXp(job.primeXp)}</span>
            )}
          </div>
        </div>
      )}

      {/* Missing ingredient pills (always visible if not ready) */}
      {!ready && missingEntries.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {missingEntries.map((m) => (
            <span key={m.item} className="text-[10px] font-mono px-2 py-0.5 rounded bg-rose-500/10 border border-rose-500/20 text-rose-700 dark:text-rose-400 font-medium">
              {m.item} {fmtNum(m.available)}/{m.required}
            </span>
          ))}
        </div>
      )}

      {/* Expanded Detail Panel */}
      {expanded && (
        <div className="border-t border-black/5 dark:border-white/5 px-3.5 pb-3.5 pt-3 space-y-3" onClick={(e) => e.stopPropagation()}>
          {/* Ingredients Checklist */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="text-[10px] font-mono font-semibold uppercase text-[#888]">
                Ingredients & Resources Required
              </div>
              {job.ingredientsBySeason && (
                <span className="text-[10px] font-mono text-sky-600 dark:text-sky-400 font-semibold">
                  {seasonBadge} Recipe
                </span>
              )}
            </div>
            <div className="space-y-1">
              {job.ingredients.map((ing) => (
                <div key={ing.item} className="flex items-center justify-between gap-2 text-xs py-0.5">
                  <span className="text-[#444] dark:text-[#bbb] font-medium truncate">
                    {ing.item}
                  </span>
                  <span className={`font-mono text-[11px] font-semibold shrink-0 ${ing.sufficient ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}>
                    {ing.sufficient ? `✓ ${fmtNum(ing.available)} in bag (need ${ing.required})` : `${fmtNum(ing.available)} / ${ing.required}`}
                  </span>
                </div>
              ))}
            </div>

            {/* Alternative Variants Note (if applicable) */}
            {job.variants && job.variants.length > 1 && (
              <div className="mt-2 p-2 rounded bg-black/[0.02] dark:bg-white/[0.02] border border-black/5 dark:border-white/5 text-[10px] font-mono text-[#888]">
                <div className="font-semibold text-[#666] dark:text-[#aaa] mb-1">Accepted Alternative Recipes:</div>
                <div className="space-y-0.5">
                  {job.variants.map((v, idx) => (
                    <div key={idx} className="flex items-center gap-1.5">
                      <span>•</span>
                      <span>{v.ingredients.map((i) => `${i.quantity}× ${i.item}`).join(" + ")}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Outputs Breakdown */}
          <div>
            <div className="text-[10px] font-mono font-semibold uppercase text-[#888] mb-1.5">
              Outputs & Products
            </div>
            <div className="space-y-1.5">
              {job.outputs.map((out) => (
                <div key={out.item} className="p-2 rounded-lg bg-black/[0.02] dark:bg-white/[0.02] border border-black/5 dark:border-white/5">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="font-semibold text-[#1a1a1a] dark:text-white truncate">{out.item}</span>
                      {out.type && (
                        <span className="text-[10px] font-mono text-[#888] shrink-0">({out.type})</span>
                      )}
                    </div>
                    <div className="font-mono font-semibold text-amber-600 dark:text-amber-400 text-xs shrink-0 whitespace-nowrap text-right">
                      +{out.amount} <span className="text-[10px] text-[#888] font-normal font-sans">({fmtNum(out.inBag)} in bag)</span>
                    </div>
                  </div>
                  {out.description && (
                    <div className="text-[10px] font-mono text-emerald-600 dark:text-emerald-400 mt-1 leading-normal break-words">
                      ✨ {out.description}
                    </div>
                  )}
                </div>
              ))}
              {job.outputs?.[0]?.primeItem && (
                <div className="p-2 rounded-lg bg-purple-500/5 dark:bg-purple-500/10 border border-purple-500/20">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <div className="text-purple-600 dark:text-purple-400 flex items-center gap-1.5 min-w-0">
                      <span className="font-semibold truncate">✨ {job.outputs[0].primeItem}</span>
                      <span className="text-[10px] font-mono text-[#888] shrink-0">({Math.round((job.primeChance ?? 0.1) * 100)}% chance)</span>
                    </div>
                    <div className="font-mono text-purple-600 dark:text-purple-400 text-xs shrink-0 whitespace-nowrap text-right">
                      +1 <span className="text-[10px] text-[#888] font-normal font-sans">({fmtNum(primeInBag)} in bag)</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* XP Breakdown (if basic/aged/prime) */}
          {job.xpDetails && (
            <div>
              <div className="flex items-center justify-between text-[10px] font-mono font-semibold uppercase text-[#888] mb-1.5">
                <span>Fish XP Breakdown</span>
                {job.primeChance && (
                  <span className="text-purple-600 dark:text-purple-400 font-normal">
                    Odds: {Math.round((job.regularChance ?? 0.9) * 100)}% Regular · {Math.round((job.primeChance ?? 0.1) * 100)}% Prime
                  </span>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2 text-center font-mono text-[10px]">
                <div className="p-1.5 rounded-lg bg-black/5 dark:bg-white/5 flex flex-col justify-center">
                  <div className="text-[#888] mb-0.5">Basic Fish</div>
                  <div className="font-bold text-emerald-600">+{job.xpDetails.basic} XP</div>
                </div>
                <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-500/20 flex flex-col justify-center">
                  <div className="text-[#888] dark:text-[#aaa] mb-0.5">Aged ({Math.round((job.regularChance ?? 0.9) * 100)}%)</div>
                  <div className="font-bold">
                    +{fmtXp(job.boostedBaseXp || job.xpDetails.aged)} XP
                  </div>
                  {job.isXpBoosted && (
                    <div className="text-[9px] text-[#888] line-through font-normal">
                      +{fmtXp(job.baseXp || job.xpDetails.aged)}
                    </div>
                  )}
                </div>
                <div className="p-1.5 rounded-lg bg-purple-500/10 text-purple-800 dark:text-purple-300 border border-purple-500/20 flex flex-col justify-center">
                  <div className="text-[#888] dark:text-[#aaa] mb-0.5">Prime Aged ({Math.round((job.primeChance ?? 0.1) * 100)}%)</div>
                  <div className="font-bold">
                    +{fmtXp(job.boostedPrimeXp || job.xpDetails.prime)} XP
                  </div>
                  {job.isXpBoosted && (
                    <div className="text-[9px] text-[#888] line-through font-normal">
                      +{fmtXp(job.primeXp || job.xpDetails.prime)}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Active Skills & Buffs (Resolved from Farm State) */}
          {job.resolvedEffects?.length > 0 && (
            <div>
              <div className="text-[10px] font-mono font-semibold uppercase text-[#888] mb-1.5">
                Active Skills & Boosts on Farm
              </div>
              <div className="space-y-1">
                {job.resolvedEffects.map((eff, i) => (
                  <div key={i} className="text-[10px] px-2 py-1 rounded-md font-mono bg-purple-500/10 border border-purple-500/20 text-purple-700 dark:text-purple-300 flex items-center justify-between gap-2">
                    <span className="font-semibold shrink-0">⚡ {eff.skill}</span>
                    <span className="text-[#666] dark:text-[#aaa] text-right truncate">{eff.effect}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Inventory Presence Snapshot */}
          <div className="pt-2 border-t border-black/5 dark:border-white/5 flex flex-wrap items-center gap-1.5 text-[10px] font-mono">
            <span className="text-[9px] uppercase font-semibold text-[#888] tracking-wider shrink-0 mr-0.5">In Bag:</span>
            {job.ingredients.map((ing) => (
              <span key={ing.item} className="px-1.5 py-0.5 rounded bg-black/5 dark:bg-white/5 text-[#555] dark:text-[#aaa] border border-black/5 dark:border-white/5 whitespace-nowrap">
                {ing.item}: <strong className="font-bold text-[#222] dark:text-[#eee]">{fmtNum(ing.available)}</strong>
              </span>
            ))}
            {job.outputs.map((out) => (
              <span key={out.item} className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-800 dark:text-amber-300 border border-amber-500/20 font-medium whitespace-nowrap">
                {out.item}: <strong className="font-bold">{fmtNum(out.inBag)}</strong>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ProcessingPage({ farm, market }) {
  const [filter, setFilter] = useState("all"); // all | ready | missing
  const [activeCategory, setActiveCategory] = useState("all"); // all | composters | agingShed | fishMarket
  const [agingSubRack, setAgingSubRack] = useState("all"); // all | aging | fermentation | spice
  const [selectedFacility, setSelectedFacility] = useState(null);
  const [seasonOverride, setSeasonOverride] = useState(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const processingData = useMemo(() => selectProcessingData(farm, seasonOverride), [farm, seasonOverride]);
  const { facilities, allJobs, byCategory, counts } = processingData;
  const currentSeason = seasonOverride ?? allJobs[0]?.currentSeason ?? "AUTUMN";

  // Filter jobs by category, sub-rack, or selected facility
  const categoryJobs = useMemo(() => {
    if (selectedFacility) {
      if (selectedFacility === "Aging Shed") {
        if (agingSubRack === "aging") return byCategory.agingRack ?? [];
        if (agingSubRack === "fermentation") return byCategory.fermentationRack ?? [];
        if (agingSubRack === "spice") return byCategory.spiceRack ?? [];
        return byCategory.agingShed ?? [];
      }
      return allJobs.filter((j) => j.building === selectedFacility);
    }
    if (activeCategory === "composters") return byCategory.composters ?? [];
    if (activeCategory === "agingShed") {
      if (agingSubRack === "aging") return byCategory.agingRack ?? [];
      if (agingSubRack === "fermentation") return byCategory.fermentationRack ?? [];
      if (agingSubRack === "spice") return byCategory.spiceRack ?? [];
      return byCategory.agingShed ?? [];
    }
    if (activeCategory === "fishMarket") return byCategory.fishMarket ?? [];
    return allJobs;
  }, [allJobs, byCategory, activeCategory, agingSubRack, selectedFacility]);

  const filteredJobs = useMemo(() => {
    return categoryJobs.filter((j) => {
      if (filter === "ready") return j.canProcess;
      if (filter === "missing") return !j.canProcess;
      return true;
    });
  }, [categoryJobs, filter]);

  const readyCount = categoryJobs.filter((j) => j.canProcess).length;
  const totalCount = categoryJobs.length;

  return (
    <div className="space-y-6">
      {/* ─── 1. Live Processing Operations (All Facilities: 5) ───────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm">⚡</span>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#787774] dark:text-[#888]">
              Live Facility Operations ({counts.builtFacilities} of {counts.totalFacilities} Built)
            </h2>
          </div>
          <span className="text-[11px] font-mono text-[#888]">
            All Facilities (5)
          </span>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
          {facilities.map((fac) => {
            const isSelected = selectedFacility === fac.name;
            const remainingMs = fac.readyAt ? Math.max(0, fac.readyAt - now) : 0;
            const isReady = fac.readyAt ? fac.readyAt <= now : false;
            const isBusy = Boolean(fac.readyAt && !isReady);

            return (
              <div
                key={fac.name}
                onClick={() => {
                  if (selectedFacility === fac.name) {
                    setSelectedFacility(null);
                  } else {
                    setSelectedFacility(fac.name);
                    setActiveCategory(fac.name === "Aging Shed" ? "agingShed" : "all");
                    if (fac.name === "Aging Shed") setAgingSubRack("all");
                  }
                }}
                className={`p-3 rounded-xl border transition-all cursor-pointer flex flex-col justify-between min-w-0 overflow-hidden ${
                  isSelected
                    ? "border-amber-500 bg-amber-500/10 shadow-sm"
                    : fac.isBuilt
                    ? "bg-white dark:bg-[#202020] border-black/10 dark:border-white/10 hover:border-black/20 dark:hover:border-white/20 shadow-xs"
                    : "bg-black/[0.02] dark:bg-white/[0.02] border border-dashed border-black/15 dark:border-white/15 opacity-70"
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center justify-between gap-1 mb-1.5 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <span className="text-base shrink-0">{fac.icon}</span>
                      <span className="font-semibold text-xs text-[#1a1a1a] dark:text-white truncate">
                        {fac.name}
                      </span>
                    </div>
                    {fac.isBuilt ? (
                      isReady ? (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 shrink-0">
                          ✓ Ready
                        </span>
                      ) : isBusy ? (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-medium bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30 shrink-0">
                          Active
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-mono text-[#888] bg-black/5 dark:bg-white/5 shrink-0">
                          Idle
                        </span>
                      )
                    ) : (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-mono text-[#888] bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 shrink-0">
                        Unplaced
                      </span>
                    )}
                  </div>

                  {/* Operational Status / Racks breakdown */}
                  {fac.facilityType === "AGING_SHED" ? (
                    <div className="space-y-1.5 my-1">
                      <div className="flex items-center justify-between text-[11px] font-mono">
                        <span className="text-[#888]">Active Racks:</span>
                        <span className="font-semibold text-amber-600 dark:text-amber-400">
                          {fac.activeSlots}/{fac.totalSlots} Slots
                        </span>
                      </div>
                      <div className="w-full bg-black/10 dark:bg-white/10 rounded-full h-1 overflow-hidden">
                        <div
                          className="bg-amber-500 h-full"
                          style={{ width: `${Math.round((fac.activeSlots / fac.totalSlots) * 100)}%` }}
                        />
                      </div>
                      <div className="flex items-center gap-1 pt-1 overflow-x-auto no-scrollbar">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedFacility("Aging Shed");
                            setActiveCategory("agingShed");
                            setAgingSubRack("aging");
                          }}
                          className={`text-[9px] font-mono px-1.5 py-0.5 rounded transition-colors shrink-0 ${
                            selectedFacility === "Aging Shed" && agingSubRack === "aging"
                              ? "bg-indigo-500 text-white font-bold"
                              : "bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 font-medium"
                          }`}
                        >
                          Aging ({byCategory.agingRack?.length ?? 38})
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedFacility("Aging Shed");
                            setActiveCategory("agingShed");
                            setAgingSubRack("fermentation");
                          }}
                          className={`text-[9px] font-mono px-1.5 py-0.5 rounded transition-colors shrink-0 ${
                            selectedFacility === "Aging Shed" && agingSubRack === "fermentation"
                              ? "bg-emerald-500 text-white font-bold"
                              : "bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 font-medium"
                          }`}
                        >
                          Ferm ({byCategory.fermentationRack?.length ?? 10})
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedFacility("Aging Shed");
                            setActiveCategory("agingShed");
                            setAgingSubRack("spice");
                          }}
                          className={`text-[9px] font-mono px-1.5 py-0.5 rounded transition-colors shrink-0 ${
                            selectedFacility === "Aging Shed" && agingSubRack === "spice"
                              ? "bg-amber-500 text-white font-bold"
                              : "bg-amber-500/10 hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 font-medium"
                          }`}
                        >
                          Spice ({byCategory.spiceRack?.length ?? 3})
                        </button>
                      </div>
                    </div>
                  ) : isBusy ? (
                    <div className="space-y-1.5 my-1">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-[#1a1a1a] dark:text-white truncate">
                          {fac.itemName ?? "Processing"}
                        </span>
                        {fac.itemAmount > 1 && (
                          <span className="text-[9px] font-mono px-1 rounded bg-amber-500/20 text-amber-700 dark:text-amber-300">
                            ×{fac.itemAmount}
                          </span>
                        )}
                      </div>
                      <div className="w-full bg-black/10 dark:bg-white/10 rounded-full h-1 overflow-hidden">
                        <div className="bg-amber-500 h-full animate-pulse" style={{ width: "65%" }} />
                      </div>
                      <div className="text-[10px] font-mono text-[#888] flex items-center justify-between">
                        <span>{formatCountdown(remainingMs)}</span>
                        {fac.oil > 0 && <span className="text-amber-600 dark:text-amber-400">🛢️ Oil</span>}
                      </div>
                    </div>
                  ) : (
                    <div className="py-1 text-[10px] font-mono text-[#888]">
                      {fac.isBuilt ? "Idle · Ready for input" : "Not placed on island"}
                    </div>
                  )}
                </div>

                {/* Active Effects / Coords Footer */}
                <div className="pt-2 border-t border-black/5 dark:border-white/5 mt-2 flex items-center justify-between text-[9px] font-mono text-[#888]">
                  <span>
                    {fac.coordinates ? `(${fac.coordinates.x}, ${fac.coordinates.y})` : "Active"}
                  </span>
                  {fac.activeEffects?.length > 0 && (
                    <span className="text-purple-600 dark:text-purple-400 truncate max-w-[90px]" title={fac.activeEffects.map((e) => e.name).join(", ")}>
                      ⚡ {fac.activeEffects[0].name}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="w-full h-px bg-black/10 dark:bg-white/10 my-4" />

      {/* ─── 2. Operations Catalogue & Jobs Section ──────────────────────── */}
      <div className="space-y-4">
        {/* Header Summary & Readiness Filters */}
        <div className="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-[#202020] p-4 rounded-xl border border-black/10 dark:border-white/10 shadow-sm">
          <div>
            <div className="text-xs text-[#888] font-mono uppercase">Operations & Production Catalogue</div>
            <div className="text-xl font-bold font-display text-[#1a1a1a] dark:text-white flex items-center gap-2 mt-0.5">
              <span>{allJobs.length} Jobs Total</span>
              <span className="text-xs font-mono font-normal text-emerald-500">
                {counts.builtFacilities} Facilities Operational
              </span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto no-scrollbar pb-0.5">
            {["all", "ready", "missing"].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors capitalize ${
                  filter === f
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

        {/* Facility & Category Filter Pills + Season Selector */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
            <button
              onClick={() => {
                setActiveCategory("all");
                setSelectedFacility(null);
                setAgingSubRack("all");
              }}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-xl text-xs font-medium border transition-all whitespace-nowrap ${
                activeCategory === "all" && !selectedFacility
                  ? "bg-amber-500/20 border-amber-500/40 text-amber-700 dark:text-amber-300 font-semibold"
                  : "bg-white dark:bg-[#202020] border-black/10 dark:border-white/10 text-[#787774] dark:text-[#999] hover:border-amber-500/30"
              }`}
            >
              <span>⚡</span>
              <span>All Jobs ({allJobs.length})</span>
            </button>

            <button
              onClick={() => {
                setActiveCategory("composters");
                setSelectedFacility(null);
                setAgingSubRack("all");
              }}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-xl text-xs font-medium border transition-all whitespace-nowrap ${
                activeCategory === "composters" && !selectedFacility
                  ? "bg-amber-500/20 border-amber-500/40 text-amber-700 dark:text-amber-300 font-semibold"
                  : "bg-white dark:bg-[#202020] border-black/10 dark:border-white/10 text-[#787774] dark:text-[#999] hover:border-amber-500/30"
              }`}
            >
              <span>🪱</span>
              <span>Composters ({byCategory.composters.length})</span>
              {byCategory.composters.filter((j) => j.canProcess).length > 0 && (
                <span className="font-mono text-[10px] bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded-full">
                  {byCategory.composters.filter((j) => j.canProcess).length}
                </span>
              )}
            </button>

            <button
              onClick={() => {
                setActiveCategory("agingShed");
                setSelectedFacility(null);
                setAgingSubRack("all");
              }}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-xl text-xs font-medium border transition-all whitespace-nowrap ${
                activeCategory === "agingShed" && !selectedFacility
                  ? "bg-amber-500/20 border-amber-500/40 text-amber-700 dark:text-amber-300 font-semibold"
                  : "bg-white dark:bg-[#202020] border-black/10 dark:border-white/10 text-[#787774] dark:text-[#999] hover:border-amber-500/30"
              }`}
            >
              <span>🏚️</span>
              <span>Aging Shed ({byCategory.agingShed.length})</span>
              {byCategory.agingShed.filter((j) => j.canProcess).length > 0 && (
                <span className="font-mono text-[10px] bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded-full">
                  {byCategory.agingShed.filter((j) => j.canProcess).length}
                </span>
              )}
            </button>

            <button
              onClick={() => {
                setActiveCategory("fishMarket");
                setSelectedFacility(null);
                setAgingSubRack("all");
              }}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-xl text-xs font-medium border transition-all whitespace-nowrap ${
                activeCategory === "fishMarket" && !selectedFacility
                  ? "bg-amber-500/20 border-amber-500/40 text-amber-700 dark:text-amber-300 font-semibold"
                  : "bg-white dark:bg-[#202020] border-black/10 dark:border-white/10 text-[#787774] dark:text-[#999] hover:border-amber-500/30"
              }`}
            >
              <span>🐟</span>
              <span>Fish Market ({byCategory.fishMarket.length})</span>
              {byCategory.fishMarket.filter((j) => j.canProcess).length > 0 && (
                <span className="font-mono text-[10px] bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 rounded-full">
                  {byCategory.fishMarket.filter((j) => j.canProcess).length}
                </span>
              )}
            </button>
          </div>

          {/* Seasonal Switcher for Fish Market */}
          <div className="flex items-center gap-1 bg-black/5 dark:bg-white/5 p-1 rounded-xl border border-black/10 dark:border-white/10 text-xs font-mono">
            <span className="text-[#888] px-1 text-[10px] uppercase font-semibold">Season:</span>
            {["AUTUMN", "WINTER", "SPRING", "SUMMER"].map((s) => {
              const isAct = currentSeason === s;
              const icons = { AUTUMN: "🍂", WINTER: "❄️", SPRING: "🌸", SUMMER: "☀️" };
              return (
                <button
                  key={s}
                  onClick={() => setSeasonOverride(s)}
                  className={`px-2 py-0.5 rounded-lg text-[11px] font-medium transition-colors ${
                    isAct
                      ? "bg-amber-500/20 border border-amber-500/30 text-amber-700 dark:text-amber-300 font-semibold shadow-xs"
                      : "text-[#787774] dark:text-[#888] hover:text-[#222] dark:hover:text-[#eee]"
                  }`}
                  title={`${s} seasonal fish requirements`}
                >
                  {icons[s]} {s.charAt(0) + s.slice(1).toLowerCase()}
                </button>
              );
            })}
          </div>
        </div>

        {/* Aging Shed 3-Part Rack Partition Sub-Bar (Aging / Fermentation / Spice) */}
        {(activeCategory === "agingShed" || selectedFacility === "Aging Shed") && (
          <div className="flex items-center gap-1.5 p-1.5 bg-black/[0.02] dark:bg-white/[0.02] border border-black/10 dark:border-white/10 rounded-xl text-xs overflow-x-auto no-scrollbar">
            <span className="text-[10px] font-mono uppercase text-[#888] px-2 font-semibold shrink-0">
              Aging Racks:
            </span>
            <button
              onClick={() => setAgingSubRack("all")}
              className={`px-3 py-1 rounded-lg font-medium transition-all shrink-0 ${
                agingSubRack === "all"
                  ? "bg-amber-500/20 border border-amber-500/40 text-amber-800 dark:text-amber-300 font-semibold shadow-xs"
                  : "text-[#787774] dark:text-[#999] hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              All Aging Shed ({byCategory.agingShed.length})
            </button>
            <button
              onClick={() => setAgingSubRack("aging")}
              className={`px-3 py-1 rounded-lg font-medium transition-all shrink-0 flex items-center gap-1.5 ${
                agingSubRack === "aging"
                  ? "bg-indigo-500/20 border border-indigo-500/40 text-indigo-800 dark:text-indigo-300 font-semibold shadow-xs"
                  : "text-[#787774] dark:text-[#999] hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              <span>🐟</span>
              <span>Aging Rack ({byCategory.agingRack.length})</span>
              {byCategory.agingRack.filter((j) => j.canProcess).length > 0 && (
                <span className="text-[10px] font-mono bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.2 rounded-full">
                  {byCategory.agingRack.filter((j) => j.canProcess).length}
                </span>
              )}
            </button>
            <button
              onClick={() => setAgingSubRack("fermentation")}
              className={`px-3 py-1 rounded-lg font-medium transition-all shrink-0 flex items-center gap-1.5 ${
                agingSubRack === "fermentation"
                  ? "bg-emerald-500/20 border border-emerald-500/40 text-emerald-800 dark:text-emerald-300 font-semibold shadow-xs"
                  : "text-[#787774] dark:text-[#999] hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              <span>🥒</span>
              <span>Fermentation Rack ({byCategory.fermentationRack.length})</span>
              {byCategory.fermentationRack.filter((j) => j.canProcess).length > 0 && (
                <span className="text-[10px] font-mono bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.2 rounded-full">
                  {byCategory.fermentationRack.filter((j) => j.canProcess).length}
                </span>
              )}
            </button>
            <button
              onClick={() => setAgingSubRack("spice")}
              className={`px-3 py-1 rounded-lg font-medium transition-all shrink-0 flex items-center gap-1.5 ${
                agingSubRack === "spice"
                  ? "bg-amber-500/20 border border-amber-500/40 text-amber-800 dark:text-amber-300 font-semibold shadow-xs"
                  : "text-[#787774] dark:text-[#999] hover:bg-black/5 dark:hover:bg-white/5"
              }`}
            >
              <span>🧂</span>
              <span>Spice Rack ({byCategory.spiceRack.length})</span>
              {byCategory.spiceRack.filter((j) => j.canProcess).length > 0 && (
                <span className="text-[10px] font-mono bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.2 rounded-full">
                  {byCategory.spiceRack.filter((j) => j.canProcess).length}
                </span>
              )}
            </button>
          </div>
        )}

        {/* Focus Banner if a single facility was selected from top row */}
        {selectedFacility && (
          <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-800 dark:text-amber-300 font-mono">
            <span>Filtered to {selectedFacility} jobs ({filteredJobs.length})</span>
            <button
              onClick={() => {
                setSelectedFacility(null);
                setAgingSubRack("all");
              }}
              className="hover:underline text-[11px]"
            >
              Clear filter ✕
            </button>
          </div>
        )}

        {/* Jobs Grid */}
        {filteredJobs.length === 0 ? (
          <div className="py-12 text-center">
            <div className="text-2xl mb-2">{filter === "ready" ? "📦" : "🔍"}</div>
            <p className="text-sm text-[#888] font-mono">
              {filter === "ready" ? "No processing jobs are ready right now." : "No jobs match your filter."}
            </p>
            <button
              onClick={() => {
                setFilter("all");
                setActiveCategory("all");
                setSelectedFacility(null);
              }}
              className="mt-2 text-xs text-amber-500 hover:underline"
            >
              Show all processing jobs
            </button>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 items-start">
            {filteredJobs.map((job) => (
              <ProcessingJobCard key={job.id} job={job} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}



function FacilityDetailCard({ building, farm, now, cropsData, animalsData, resourcesData, market }) {
  const isBuilt = building.isBuilt;
  const isBusy = building.isBusy;
  const remainingMs = building.readyAt ? Math.max(0, building.readyAt - now) : 0;
  const isReady = building.readyAt ? building.readyAt <= now : false;
  const inventory = farm?.inventory ?? farm?.canonical?.inventory ?? {};

  return (
    <div className={`p-4 rounded-xl border transition-all ${
      isBuilt
        ? "bg-white dark:bg-[#202020] border-black/10 dark:border-white/10 shadow-sm"
        : "bg-black/[0.02] dark:bg-white/[0.02] border-black/5 dark:border-white/5 opacity-70"
    }`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-xl">{building.icon}</span>
          <div>
            <h3 className="text-sm font-bold font-display text-[#1a1a1a] dark:text-white">
              {building.name}
            </h3>
            <span className="text-[10px] font-mono text-[#888]">
              Model: {building.productionModel}
            </span>
          </div>
        </div>
        {isBuilt ? (
          <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30">
            Active on Island
          </span>
        ) : (
          <span className="px-2 py-0.5 rounded text-[10px] font-mono text-[#888] bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10">
            Not Placed
          </span>
        )}
      </div>

      {/* Building Details */}
      {isBuilt ? (
        <div className="space-y-2 mt-3 text-xs">
          {/* Status & Operational Timer if active */}
          <div className="flex items-center justify-between p-2 rounded-lg bg-black/5 dark:bg-white/5">
            <span className="text-[#888] font-mono text-[11px]">Operation Status:</span>
            {isBusy ? (
              <span className="font-mono font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                {isReady ? "Ready to Collect" : `In Progress (${formatCountdown(remainingMs)})`}
              </span>
            ) : (
              <span className="font-mono text-[#888]">Idle / Ready</span>
            )}
          </div>

          {/* Coordinates & Oil */}
          <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-[#888]">
            {building.coordinates && (
              <div className="p-1.5 rounded bg-black/[0.03] dark:bg-white/[0.03]">
                Coords: ({building.coordinates.x}, {building.coordinates.y})
              </div>
            )}
            {building.oil > 0 && (
              <div className="p-1.5 rounded bg-black/[0.03] dark:bg-white/[0.03] text-amber-600 dark:text-amber-400">
                Oil: {building.oil} (+20% Speed)
              </div>
            )}
          </div>

          {/* Specialized Building Details */}
          {building.name.includes("Compost") && (
            <div className="text-[11px] font-mono text-[#888] pt-1">
              Baits Produced: Earthworm ({inventory['Earthworm'] || 0}) · Grub ({inventory['Grub'] || 0})
            </div>
          )}
          {building.name === "Aging Shed" && (
            <div className="text-[11px] font-mono text-[#888] pt-1">
              Fermentation & Aging · Aged Cheese: {inventory['Aged Cheese'] || 0}
            </div>
          )}
          {building.name === "Fish Market" && (
            <div className="text-[11px] font-mono text-[#888] pt-1">
              Fish Harvested: {inventory['Anchovy'] || 0} Anchovy · {inventory['Tuna'] || 0} Tuna
            </div>
          )}
          {building.name === "Greenhouse" && (
            <div className="text-[11px] font-mono text-[#888] pt-1">
              Active Pots: {cropsData.greenhouse?.activeCount ?? 0} · Oil Reservoir: {cropsData.greenhouse?.oil ?? 0}
            </div>
          )}
          {building.name === "Crop Machine" && (
            <div className="text-[11px] font-mono text-[#888] pt-1">
              Automated Plot Sowing & Batch Queue Production
            </div>
          )}
          {building.name === "Hen House" && (
            <div className="text-[11px] font-mono text-[#888] pt-1">
              Flock: {animalsData.henHouse?.chickensCount || 0} Chickens · Eggs in Stock: {animalsData.henHouse?.eggsInStock || 0}
            </div>
          )}
          {building.name === "Barn" && (
            <div className="text-[11px] font-mono text-[#888] pt-1">
              Livestock: {animalsData.barn?.cowsCount || 0} Cows, {animalsData.barn?.sheepCount || 0} Sheep · Milk: {animalsData.barn?.milkStock || 0}
            </div>
          )}
          {building.name === "Workbench" && (
            <div className="text-[11px] font-mono text-[#888] pt-1">
              Tool Crafting: Axes ({inventory['Axe'] || 0}) · Pickaxes ({inventory['Pickaxe'] || 0}) · Shovels ({inventory['Rusty Shovel'] || 0})
            </div>
          )}
          {building.name === "Crafting Box" && (
            <div className="text-[11px] font-mono text-[#888] pt-1">
              Decorative items & specialized equipment blueprints
            </div>
          )}
          {building.name === "Water Well" && (
            <div className="text-[11px] font-mono text-[#888] pt-1">
              Ground Water Extraction: Active Island Hydration
            </div>
          )}
          {building.name === "Market" && (
            <div className="text-[11px] font-mono text-[#888] pt-1">
              Trading Post: Live crop liquidation & seed merchant
            </div>
          )}
          {(building.name === "Toolshed" || building.name === "Warehouse") && (
            <div className="text-[11px] font-mono text-[#888] pt-1">
              Storage Vault: Hardware tools & raw materials capacity
            </div>
          )}
          {building.name === "Pet House" && (
            <div className="text-[11px] font-mono text-[#888] pt-1">
              Pet Sanctuary: Companion loyalty & energy recharging
            </div>
          )}
          {(building.name === "Manor" || building.name === "Mansion") && (
            <div className="text-[11px] font-mono text-[#888] pt-1">
              Island Estate: Territory expansion & prestige headquarters
            </div>
          )}
        </div>
      ) : (
        <div className="mt-3 py-3 text-center rounded-lg border border-dashed border-black/10 dark:border-white/10 text-[11px] font-mono text-[#888]">
          Facility not yet placed on this farm
        </div>
      )}
    </div>
  );
}

function BuildingCategoryPage({ categoryKey, farm, market }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const categoryInfo = useMemo(() => selectCategoryBuildings(farm, categoryKey), [farm, categoryKey]);
  const cropsData = useMemo(() => selectCropData(farm), [farm]);
  const animalsData = useMemo(() => selectAnimalData(farm), [farm]);
  const resourcesData = useMemo(() => selectResourceData(farm), [farm]);

  if (!categoryInfo?.category) return null;
  const { category, buildings, builtCount, totalCount } = categoryInfo;

  return (
    <div className="space-y-6">
      {/* Category Overview Card */}
      <div className="bg-white dark:bg-[#202020] p-4 rounded-xl border border-black/10 dark:border-white/10 shadow-sm flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs text-[#888] font-mono uppercase">Category Overview</div>
          <div className="text-xl font-bold font-display text-[#1a1a1a] dark:text-white flex items-center gap-2 mt-0.5">
            <span>{category.icon} {category.name}</span>
            <span className="text-xs font-mono font-normal text-emerald-500">
              {builtCount} of {totalCount} Built
            </span>
          </div>
          <p className="text-xs text-[#787774] dark:text-[#888] mt-1 font-sans">
            {category.description}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="px-2.5 py-1 rounded-lg text-xs font-mono font-medium bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 text-[#666] dark:text-[#aaa]">
            Model: {category.productionModel}
          </span>
        </div>
      </div>

      {/* Buildings Facilities Grid */}
      <div className="grid sm:grid-cols-2 gap-4">
        {buildings.map((b) => (
          <FacilityDetailCard
            key={b.name}
            building={b}
            farm={farm}
            now={now}
            cropsData={cropsData}
            animalsData={animalsData}
            resourcesData={resourcesData}
            market={market}
          />
        ))}
      </div>
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
   DEVELOPER MODE FARM SWITCHER MODAL & CONTROL DECK
═════════════════════════════════════════════════════════════════════════════ */
function DevFarmSwitcherModal({
  open,
  onClose,
  devMode,
  onToggleDevMode,
  devFarmId,
  accountFarmId,
  recentFarms,
  onSwitchFarm,
  onResetToAccountFarm,
  feedback,
}) {
  const [customInput, setCustomInput] = useState("");

  if (!open) return null;

  const presets = [
    { label: "My Account Farm", id: accountFarmId, icon: "🌾", desc: "Native account farm" },
    { label: "Desert Island (L62)", id: "346853928974080", icon: "🏜️", desc: "Late-game tier with 25 skills" },
    { label: "Community Active", id: "29411", icon: "🚜", desc: "Active mid-tier farm" },
    { label: "Official Reference", id: "10340", icon: "🛡️", desc: "Baseline test farm" },
  ];

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!customInput.trim()) return;
    onSwitchFarm(customInput.trim());
    setCustomInput("");
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 dark:bg-black/80 backdrop-blur-xs select-none"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-white dark:bg-[#1a1a1c] border border-black/15 dark:border-white/15 rounded-2xl shadow-2xl overflow-hidden flex flex-col transition-all"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3.5 bg-[#f4f3ef] dark:bg-[#141416] border-b border-black/10 dark:border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base">🛠️</span>
            <div>
              <div className="text-xs font-bold text-[#1a1a1a] dark:text-white font-display">
                Developer Control Deck
              </div>
              <div className="text-[10px] font-mono text-[#888]">
                Multi-farm hot-swapping & testing
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Toggle switch */}
            <button
              onClick={onToggleDevMode}
              className={`px-2.5 py-1 rounded-full text-[10px] font-mono font-bold transition-all border ${
                devMode
                  ? "bg-purple-500/20 text-purple-700 dark:text-purple-300 border-purple-500/40"
                  : "bg-black/5 dark:bg-white/5 text-[#888] border-black/10 dark:border-white/10"
              }`}
            >
              DEV MODE: {devMode ? "ON" : "OFF"}
            </button>
            <button
              onClick={onClose}
              className="w-6 h-6 rounded-full flex items-center justify-center text-xs text-[#888] hover:text-[#1a1a1a] dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 max-h-[80vh] overflow-y-auto">
          {/* Active Status Banner */}
          <div
            className={`p-3 rounded-xl border text-xs font-mono flex items-center justify-between gap-2 ${
              devMode && devFarmId
                ? "bg-purple-500/10 border-purple-500/30 text-purple-700 dark:text-purple-300"
                : "bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 text-[#666] dark:text-[#aaa]"
            }`}
          >
            <div className="flex items-center gap-2 truncate">
              <span className="w-2 h-2 rounded-full bg-current animate-pulse shrink-0"></span>
              <span className="truncate">
                {devMode && devFarmId ? (
                  <>
                    <span className="font-bold">Active Override:</span> #{devFarmId}
                  </>
                ) : (
                  <>
                    <span className="font-bold">Active Account Farm:</span> #{accountFarmId || "Not Set"}
                  </>
                )}
              </span>
            </div>
            {devMode && devFarmId && (
              <button
                onClick={onResetToAccountFarm}
                className="text-[10px] underline font-semibold hover:opacity-80 shrink-0"
              >
                Reset to My Farm
              </button>
            )}
          </div>

          {feedback && (
            <div className="p-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-700 dark:text-emerald-400 text-xs font-mono text-center">
              {feedback}
            </div>
          )}

          {/* Direct Input */}
          <div>
            <label className="block text-[11px] font-mono text-[#888] uppercase tracking-wider mb-1.5 font-semibold">
              Enter Farm ID to Inspect
            </label>
            <form onSubmit={handleSubmit} className="flex gap-2">
              <input
                type="text"
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                placeholder="e.g. 346853928974080 or 29411"
                className="flex-1 px-3 py-2 rounded-xl bg-black/5 dark:bg-black/30 border border-black/10 dark:border-white/10 text-xs text-[#1a1a1a] dark:text-white placeholder-[#888] outline-none focus:border-amber-500 transition-colors font-mono"
              />
              <button
                type="submit"
                disabled={!customInput.trim()}
                className="px-3 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs font-mono transition-all disabled:opacity-40 disabled:hover:bg-amber-500 shrink-0"
              >
                ⚡ Switch Farm
              </button>
            </form>
          </div>

          {/* Quick Presets */}
          <div>
            <div className="text-[11px] font-mono text-[#888] uppercase tracking-wider mb-2 font-semibold">
              Instant Preset Farms
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {presets.map((p) => {
                const isActive = (devMode && devFarmId ? devFarmId : accountFarmId) === p.id;
                return (
                  <button
                    key={p.id || p.label}
                    onClick={() => {
                      if (p.id === accountFarmId && (!devMode || !devFarmId)) return;
                      if (p.id === accountFarmId) {
                        onResetToAccountFarm();
                      } else {
                        onSwitchFarm(p.id);
                      }
                    }}
                    disabled={!p.id}
                    className={`p-2.5 rounded-xl border text-left transition-all flex items-start gap-2.5 ${
                      isActive
                        ? "border-purple-500 bg-purple-500/10 dark:bg-purple-500/15"
                        : "border-black/10 dark:border-white/10 hover:border-black/25 dark:hover:border-white/25 hover:bg-black/5 dark:hover:bg-white/5"
                    }`}
                  >
                    <span className="text-lg">{p.icon}</span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-bold text-[#1a1a1a] dark:text-white truncate flex items-center justify-between">
                        <span>{p.label}</span>
                        {isActive && (
                          <span className="text-[9px] font-mono px-1 py-0.5 rounded bg-purple-500/30 text-purple-700 dark:text-purple-300 font-bold">
                            Active
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] font-mono text-[#888] truncate">
                        ID: {p.id || "—"}
                      </div>
                      <div className="text-[10px] text-[#666] dark:text-[#999] truncate">
                        {p.desc}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Recent Farms History */}
          {recentFarms && recentFarms.length > 0 && (
            <div>
              <div className="text-[11px] font-mono text-[#888] uppercase tracking-wider mb-1.5 font-semibold">
                Recently Tested Farms
              </div>
              <div className="flex flex-wrap gap-1.5">
                {recentFarms.map((rf) => (
                  <button
                    key={rf}
                    onClick={() => onSwitchFarm(rf)}
                    className={`px-2 py-1 rounded-lg text-xs font-mono border transition-all ${
                      devFarmId === rf
                        ? "border-purple-500 bg-purple-500/20 text-purple-700 dark:text-purple-300 font-bold"
                        : "border-black/10 dark:border-white/10 hover:border-amber-500/50 bg-black/5 dark:bg-white/5 text-[#666] dark:text-[#aaa]"
                    }`}
                  >
                    #{rf}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 bg-[#f4f3ef] dark:bg-[#141416] border-t border-black/10 dark:border-white/10 flex items-center justify-between text-[11px] font-mono text-[#888]">
          <span>Changes apply immediately without database mutations</span>
          <button
            onClick={onClose}
            className="px-3 py-1 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 text-[#333] dark:text-[#ccc]"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═════════════════════════════════════════════════════════════════════════════
   ANTIGRAVITY-STYLE FLOATING POPUP WINDOW FOR CHAT INTERFACE
═════════════════════════════════════════════════════════════════════════════ */
const NEW_SESSION = () => crypto.randomUUID();

function AntigravityChatModal({ open, onClose, sessionId, msgs, setMsgs, onNewSession, farm, user, activeFarmId, isDevOverride, onCreditsUpdated }) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const endRef = useRef(null);
  const inputRef = useRef(null);

  const isDev = user?.username === "dev" || user?.role === "DEVELOPER" || isDevOverride;
  const currentCredits = isDev ? 999999 : (user?.aiCredits ?? user?.ai_credits ?? 50);

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
    if (!isDev && currentCredits <= 0) {
      setMsgs((m) => [
        ...m,
        {
          role: "ai",
          text: "⚠️ You have exhausted your AI credits (0 remaining). Please contact support to recharge your credits.",
        },
      ]);
      return;
    }
    setMsgs((m) => [...m, { role: "you", text }]);
    setInput("");
    setBusy(true);
    try {
      const r = await api.chat(text, sessionId);
      if (r?.creditsRemaining !== undefined && onCreditsUpdated) {
        onCreditsUpdated(r.creditsRemaining);
      }
      setMsgs((m) => [...m, { role: "ai", text: r.answer ?? (r.error ? `⚠️ ${r.error}` : "No response received"), steps: r.steps ?? [] }]);
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

              {/* In-Modal AI Credit Pill */}
              <div
                className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-mono border transition-all ${
                  isDev
                    ? "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30 font-semibold"
                    : currentCredits <= 0
                    ? "bg-rose-500/20 text-rose-700 dark:text-rose-400 border-rose-500/40 font-bold animate-pulse"
                    : currentCredits <= 5
                    ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 font-bold"
                    : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-500/25 font-medium"
                }`}
                title={isDev ? "Developer Account: Unlimited AI Usage" : `${currentCredits} AI Credits Remaining (1 credit per prompt)`}
              >
                <span>⚡</span>
                <span>{isDev ? "Unlimited (Dev)" : `${currentCredits} Credits`}</span>
              </div>
            </div>
          </div>

          {/* Center Context Indicator */}
          <div className="hidden md:flex items-center gap-2 text-[11px] font-mono text-[#666] dark:text-[#888]">
            <span className={`w-1.5 h-1.5 rounded-full ${isDevOverride ? "bg-purple-500 animate-pulse" : "bg-emerald-500 animate-pulse"}`}></span>
            <span>Farm #{activeFarmId || user?.farmId || user?.farm_id || "Active"}</span>
            {isDevOverride && (
              <span className="text-[9px] font-mono px-1 py-0.2 rounded bg-purple-500/20 text-purple-600 dark:text-purple-400 font-bold">
                DEV OVERRIDE
              </span>
            )}
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
              <p className="text-xs text-[#666] dark:text-[#999] max-w-sm mb-4 font-mono">
                Ask anything about cooking schedules, XP projections, inventory arbitrage, or island delivery priorities.
              </p>

              {/* AI Copilot Credit Quota Balance Card */}
              <div className="w-full max-w-sm mb-5 p-2.5 rounded-xl bg-black/[0.03] dark:bg-white/[0.03] border border-black/10 dark:border-white/10 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/15 flex items-center justify-center text-base">⚡</div>
                  <div className="text-left">
                    <div className="font-semibold text-[#1a1a1a] dark:text-white text-[11px]">AI Copilot Balance</div>
                    <div className="text-[10px] font-mono text-[#888]">1 query = 1 credit reserved</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className={`font-mono font-bold text-xs ${isDev ? "text-purple-600 dark:text-purple-400" : currentCredits <= 0 ? "text-rose-500 font-bold" : currentCredits <= 5 ? "text-amber-600 font-bold" : "text-emerald-600 dark:text-emerald-400"}`}>
                    {isDev ? "⚡ Unlimited" : `⚡ ${currentCredits} Credits`}
                  </div>
                  <div className="text-[9px] text-[#888] font-mono">{isDev ? "Developer tier" : "Initial allocation: 50"}</div>
                </div>
              </div>

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
          {!isDev && currentCredits <= 0 && (
            <div className="mb-2.5 p-2.5 rounded-lg bg-rose-500/15 border border-rose-500/30 text-rose-800 dark:text-rose-300 text-xs flex items-center justify-between">
              <span className="flex items-center gap-2">
                <span>⚠️</span>
                <span>You have exhausted your AI credits (0 remaining). Please contact support to recharge.</span>
              </span>
            </div>
          )}

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
              disabled={!isDev && currentCredits <= 0}
              onChange={(e) => setInput(e.target.value)}
              placeholder={!isDev && currentCredits <= 0 ? "AI credits exhausted (0 remaining)..." : "Ask Dr. Bumpkin (e.g. What should I cook?)..."}
              className="flex-1 bg-transparent px-3 py-2 text-xs text-[#1a1a1a] dark:text-white placeholder-[#888] dark:placeholder-[#777] outline-none font-sans disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={busy || !input.trim() || (!isDev && currentCredits <= 0)}
              className="px-3 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 font-bold rounded-lg transition-all text-xs flex items-center gap-1.5 shadow-md shadow-amber-500/10"
            >
              <span>Send</span>
              <span>➤</span>
            </button>
          </form>

          <div className="mt-2 px-1 flex items-center justify-between text-[10px] font-mono text-[#777] select-none">
            <span className="flex items-center gap-1.5">
              <span className="text-amber-500 font-bold">⚡</span>
              <span>{isDev ? "Unlimited Developer Access" : `1 credit consumed per prompt · ${currentCredits} available`}</span>
            </span>
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
  // CORE OPERATIONS
  { id: "Dashboard", title: "Overview", icon: "/bumpkin-chibi (2).webp", category: "Core Operations" },
  { id: "Planner", title: "Cooking & XP Planner", icon: "/bumpkin-chibi (4).webp", category: "Core Operations" },

  // BUILDINGS
  { id: "Cooking", title: "Cooking", icon: "🍳", category: "Buildings" },
  { id: "Processing", title: "Processing", icon: "🪱", category: "Buildings" },
  { id: "CropProduction", title: "Crop Production", icon: "🌱", category: "Buildings" },
  { id: "AnimalProduction", title: "Animal Production", icon: "🐄", category: "Buildings" },
  { id: "Crafting", title: "Crafting", icon: "🔨", category: "Buildings" },
  { id: "ResourceGen", title: "Resource Generation", icon: "💧", category: "Buildings" },
  { id: "Trading", title: "Trading", icon: "🏪", category: "Buildings" },
  { id: "Storage", title: "Storage", icon: "📦", category: "Buildings" },
  { id: "AnimalUtility", title: "Animal Utility", icon: "🐶", category: "Buildings" },
  { id: "Utility", title: "Utility", icon: "🏛️", category: "Buildings" },

  // INTELLIGENCE
  { id: "Market", title: "Market & Valuation", icon: "/npc-hammerin-harry-chibi.webp", category: "Intelligence" },
  { id: "Activity", title: "Delta Tracker", icon: "/bumpkin-chibi (1).webp", category: "Intelligence" },
  { id: "Quests", title: "Chores & Deliveries", icon: "/bumpkin-chibi (3).webp", category: "Intelligence" },

  // VAULT MEMORY
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
  const { user, loading, isAuthenticated, logout, setAiCredits } = useAuth();

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

  const isDevUser = user?.username === 'dev' || user?.role === 'DEVELOPER';
  const userCredits = isDevUser ? 999999 : (user?.aiCredits ?? user?.ai_credits ?? 50);

  // Developer Mode & Multi-Farm Testing State (strictly reserved for 'dev' account)
  const [devMode, setDevMode] = useState(() => {
    return isDevUser && localStorage.getItem('dev_mode_active') !== 'false';
  });
  const [devFarmId, setDevFarmId] = useState(() => (isDevUser ? (localStorage.getItem('dev_override_farm_id') || '') : ''));
  const [recentDevFarms, setRecentDevFarms] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('dev_recent_farms')) || ['346853928974080', '29411', '10340'];
    } catch {
      return ['346853928974080', '29411', '10340'];
    }
  });
  const [devModalOpen, setDevModalOpen] = useState(false);
  const [switchFeedback, setSwitchFeedback] = useState('');

  // Strictly enforce that only 'dev' account gets Developer Mode
  useEffect(() => {
    if (user?.username === 'dev') {
      const saved = localStorage.getItem('dev_mode_active');
      setDevMode(saved !== 'false');
      setDevFarmId(localStorage.getItem('dev_override_farm_id') || '');
    } else {
      setDevMode(false);
      setDevFarmId('');
      setDevModalOpen(false);
    }
  }, [user?.username]);

  const activeFarmId = (isDevUser && devMode && devFarmId) ? devFarmId : (user?.farmId || user?.farm_id);
  const isDevOverride = Boolean(isDevUser && devMode && devFarmId && devFarmId !== (user?.farmId || user?.farm_id));

  const handleSwitchFarm = (newFarmId) => {
    if (!isDevUser) return;
    const id = (newFarmId || '').trim();
    if (!id || !/^\d+$/.test(id)) {
      setSwitchFeedback('⚠️ Please enter a valid numeric Farm ID');
      return;
    }
    setDevFarmId(id);
    localStorage.setItem('dev_override_farm_id', id);
    setDevMode(true);
    localStorage.setItem('dev_mode_active', 'true');

    // Update recent farms list
    setRecentDevFarms((prev) => {
      const updated = [id, ...prev.filter((f) => f !== id)].slice(0, 6);
      localStorage.setItem('dev_recent_farms', JSON.stringify(updated));
      return updated;
    });

    setSwitchFeedback(`✅ Switched to Farm #${id}`);
    setTimeout(() => {
      setSwitchFeedback('');
      setDevModalOpen(false);
    }, 500);
  };

  const handleResetToAccountFarm = () => {
    if (!isDevUser) return;
    setDevFarmId('');
    localStorage.removeItem('dev_override_farm_id');
    setSwitchFeedback('↩️ Reverted to account default farm');
    setTimeout(() => {
      setSwitchFeedback('');
      setDevModalOpen(false);
    }, 500);
  };

  const handleToggleDevMode = () => {
    if (!isDevUser) return;
    const nextVal = !devMode;
    setDevMode(nextVal);
    localStorage.setItem('dev_mode_active', String(nextVal));
    if (!nextVal) {
      setDevFarmId('');
      localStorage.removeItem('dev_override_farm_id');
    }
  };

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
  if (!user?.farmId && !user?.farm_id && !(isDevUser && devFarmId)) return <FarmSetup />;

  const currentPage = PAGES.find((p) => p.id === tab) || (tab === "Recipes" ? PAGES.find((p) => p.id === "Cooking") : PAGES[0]);

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
          {/* Developer Farm Switcher Button (Strictly 'dev' Account Only) */}
          {isDevUser && (
            <button
              onClick={() => setDevModalOpen(true)}
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-mono border transition-all shrink-0 ${
                devMode && devFarmId
                  ? "bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/40 hover:bg-purple-500/25 shadow-sm"
                  : devMode
                  ? "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/40 hover:bg-amber-500/25"
                  : "bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 hover:border-amber-500/30 text-[#666] dark:text-[#888]"
              }`}
              title="Developer Mode: Switch Farm ID"
            >
              <span className="text-xs">🛠️</span>
              <span className="font-semibold hidden sm:inline">
                {devMode && devFarmId ? `Dev #${devFarmId}` : devMode ? "Dev Active" : "Dev"}
              </span>
              {devMode && devFarmId && (
                <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse"></span>
              )}
            </button>
          )}

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

          {/* AI Credits Badge (Click opens Dr. Bumpkin) */}
          <button
            onClick={() => setCopilotOpen(true)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-mono border transition-all shrink-0 cursor-pointer shadow-xs hover:scale-105 select-none ${
              isDevUser
                ? "bg-purple-500/15 hover:bg-purple-500/25 text-purple-700 dark:text-purple-300 border-purple-500/40 font-semibold"
                : userCredits <= 0
                ? "bg-rose-500/20 hover:bg-rose-500/30 text-rose-700 dark:text-rose-400 border-rose-500/50 font-bold animate-pulse"
                : userCredits <= 5
                ? "bg-amber-500/15 hover:bg-amber-500/25 text-amber-700 dark:text-amber-400 border-amber-500/40 font-bold"
                : "bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 font-medium"
            }`}
            title={isDevUser ? "Developer Account: Unlimited AI Usage" : `AI Copilot: ${userCredits} Credits Remaining (1 credit/query). Click to open chat.`}
          >
            <span className="text-amber-500 dark:text-amber-400 animate-pulse">⚡</span>
            <span>{isDevUser ? "Unlimited (Dev)" : `${userCredits} Credits`}</span>
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
                    <div>Farm: #{activeFarmId} {isDevOverride && "(Dev)"}</div>
                    <div className="flex items-center justify-between mt-1 pt-1 border-t border-black/5 dark:border-white/5 text-[10px]">
                      <span>AI Credits:</span>
                      <span className={isDevUser ? "text-purple-600 dark:text-purple-400 font-bold" : userCredits <= 0 ? "text-rose-500 font-bold" : userCredits <= 5 ? "text-amber-500 font-bold" : "text-emerald-600 dark:text-emerald-400 font-semibold"}>
                        {isDevUser ? "⚡ Unlimited (Dev)" : `⚡ ${userCredits}`}
                      </span>
                    </div>
                  </div>
                  {isDevUser && (
                    <button
                      onClick={() => { setShowUserMenu(false); setDevModalOpen(true); }}
                      className="w-full text-left px-2 py-1.5 mt-1 rounded text-[#555] dark:text-[#aaa] hover:bg-black/5 dark:hover:bg-white/5 font-medium transition-colors flex items-center justify-between"
                    >
                      <span className="flex items-center gap-1.5">
                        <span>🛠️</span>
                        <span>Developer Mode</span>
                      </span>
                      <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-bold ${devMode ? 'bg-purple-500/20 text-purple-600 dark:text-purple-400' : 'bg-black/5 dark:bg-white/10 text-[#888]'}`}>
                        {devMode ? (devFarmId ? `#${devFarmId}` : 'ON') : 'OFF'}
                      </span>
                    </button>
                  )}
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
                      <div className="text-[10px] text-[#888] truncate flex items-center gap-1">
                        <span className="truncate">{user?.username}</span>
                        <span>·</span>
                        <span className={isDevUser ? "text-purple-600 dark:text-purple-400 font-bold" : userCredits <= 0 ? "text-rose-500 font-bold" : userCredits <= 5 ? "text-amber-500 font-bold" : "text-emerald-600 dark:text-emerald-400 font-medium"}>
                          ⚡ {isDevUser ? "Unlimited" : `${userCredits} cr`}
                        </span>
                      </div>
                    </div>
                  </div>
                  <span className="text-[10px] opacity-60">▾</span>
                </button>

                {/* Account Popover Menu */}
                {showUserMenu && (
                  <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-[#282828] border border-black/10 dark:border-white/10 rounded-xl shadow-xl p-2 z-50 text-xs">
                    <div className="px-2 py-1.5 border-b border-black/5 dark:border-white/5 text-[11px] font-mono text-[#888]">
                      <div>User: {user?.username}</div>
                      <div>Farm: #{activeFarmId} {isDevOverride && "(Dev)"}</div>
                      <div className="flex items-center justify-between mt-1 pt-1 border-t border-black/5 dark:border-white/5 text-[10px]">
                        <span>AI Credits:</span>
                        <span className={isDevUser ? "text-purple-600 dark:text-purple-400 font-bold" : userCredits <= 0 ? "text-rose-500 font-bold" : userCredits <= 5 ? "text-amber-500 font-bold" : "text-emerald-600 dark:text-emerald-400 font-semibold"}>
                          {isDevUser ? "⚡ Unlimited (Dev)" : `⚡ ${userCredits} Credits`}
                        </span>
                      </div>
                    </div>
                    {isDevUser && (
                      <button
                        onClick={() => { setShowUserMenu(false); setDevModalOpen(true); }}
                        className="w-full text-left px-2 py-1.5 mt-1 rounded text-[#555] dark:text-[#aaa] hover:bg-black/5 dark:hover:bg-white/5 font-medium transition-colors flex items-center justify-between"
                      >
                        <span className="flex items-center gap-1.5">
                          <span>🛠️</span>
                          <span>Developer Mode</span>
                        </span>
                        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded font-bold ${devMode ? 'bg-purple-500/20 text-purple-600 dark:text-purple-400' : 'bg-black/5 dark:bg-white/10 text-[#888]'}`}>
                          {devMode ? (devFarmId ? `#${devFarmId}` : 'ON') : 'OFF'}
                        </span>
                      </button>
                    )}
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
                {["Core Operations", "Buildings", "Intelligence", "Vault Memory"].map((category) => {
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
                            className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition-colors text-left ${tab === p.id || (tab === "Recipes" && p.id === "Cooking") ? "bg-black/10 dark:bg-white/10 font-semibold text-[#1a1a1a] dark:text-white" : "text-[#787774] dark:text-[#999] hover:bg-black/5 dark:hover:bg-white/5 hover:text-[#1a1a1a] dark:hover:text-white"}`}
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
                {currentPage.category === "Buildings"
                  ? `${currentPage.title} facility operations and production tracking`
                  : "Real-time operational dashboard and tactical automation node"}
              </p>
            </div>

            {/* Notion Collapsible Frontmatter Properties Drawer */}
            <div className="mb-6 md:mb-8 p-2.5 md:p-3 rounded-xl border border-black/10 dark:border-white/10 bg-[#fbfbfa] dark:bg-[#202020] space-y-0.5">
              <PropertyItem
                icon="🧑‍🌾"
                label="Farm Account"
                value={
                  isDevOverride
                    ? `${user?.username} · Dev Override: #${devFarmId} (Account: #${user?.farmId || user?.farm_id})`
                    : `${user?.username} (ID: ${activeFarmId})`
                }
              />
              <PropertyItem icon="⭐" label="Bumpkin Tier" value={farm ? `Level ${farm.bumpkin.level} (${fmt(farm.bumpkin.xp)} XP)` : "Loading..."} />
              <PropertyItem icon="🌸" label="Liquid FLOWER" value={farm ? `${Number(farm.currencies.flowerApprox).toFixed(2)} FLOWER` : "—"} />
              <PropertyItem icon="🎯" label="Target Milestone" value="Level 100 Bumpkin Mastery" />
              <PropertyItem icon="⚡" label="Data Synchronization" value={farm?.stale ? "Stale Cache" : "Live Polygon RPC & SFL Gateway"} />
              {farm?.rawHash && (
                <PropertyItem icon="🛡️" label="State Fingerprint" value={`SHA-256: ${farm.rawHash.slice(0, 10)}... (Loss-Aware)`} />
              )}
            </div>

            {/* Active Document Page Body */}
            {tab === "Dashboard" && <Dashboard farm={farm} plan={plan} />}
            {tab === "Planner" && <Planner plan={plan} />}
            {(tab === "Cooking" || tab === "Recipes") && <CookingPage recipesData={recipesData} farm={farm} />}
            {tab === "Market" && <Market farm={farm} market={market} />}
            {tab === "Activity" && <Activity />}
            {tab === "Quests" && <Quests farm={farm} />}
            {tab === "History" && <History onResume={handleResume} />}
            {tab === "Processing" && <ProcessingPage farm={farm} market={market} />}
            {tab === "CropProduction" && <BuildingCategoryPage categoryKey="CROP_PRODUCTION" farm={farm} market={market} />}
            {tab === "AnimalProduction" && <BuildingCategoryPage categoryKey="ANIMAL_PRODUCTION" farm={farm} market={market} />}
            {tab === "Crafting" && <BuildingCategoryPage categoryKey="CRAFTING" farm={farm} market={market} />}
            {tab === "ResourceGen" && <BuildingCategoryPage categoryKey="RESOURCE_GENERATION" farm={farm} market={market} />}
            {tab === "Trading" && <BuildingCategoryPage categoryKey="TRADING" farm={farm} market={market} />}
            {tab === "Storage" && <BuildingCategoryPage categoryKey="STORAGE" farm={farm} market={market} />}
            {tab === "AnimalUtility" && <BuildingCategoryPage categoryKey="ANIMAL_UTILITY" farm={farm} market={market} />}
            {tab === "Utility" && <BuildingCategoryPage categoryKey="UTILITY" farm={farm} market={market} />}
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
          activeFarmId={activeFarmId}
          isDevOverride={isDevOverride}
          onCreditsUpdated={setAiCredits}
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
          <span className="truncate">
            Farm: #{activeFarmId}
            {isDevOverride && <span className="text-purple-600 dark:text-purple-400 font-bold ml-1.5">[Dev Override]</span>}
          </span>
          <span className="opacity-40 hidden xs:inline">|</span>
          <span className="hidden xs:inline truncate">Bumpkin: Lv {farm?.bumpkin.level ?? "—"}</span>
        </div>

        <div className="hidden sm:flex items-center gap-3 shrink-0">
          <button
            onClick={() => setCopilotOpen(true)}
            className="flex items-center gap-1 hover:text-amber-500 transition-colors cursor-pointer select-none"
            title="AI Copilot Balance (Click to open Dr. Bumpkin)"
          >
            <span className="text-amber-500">⚡</span>
            <span>Credits:</span>
            <span className={isDevUser ? "text-purple-600 dark:text-purple-400 font-bold" : userCredits <= 0 ? "text-rose-500 font-bold" : userCredits <= 5 ? "text-amber-500 font-bold" : "text-emerald-600 dark:text-emerald-400 font-semibold"}>
              {isDevUser ? "Unlimited" : userCredits}
            </span>
          </button>
          <span className="opacity-40">|</span>
          <span>FLOWER: {Number(farm?.currencies.flowerApprox ?? 0).toFixed(2)}</span>
          <span className="opacity-40">|</span>
          <span className="text-amber-500 font-medium">Deterministic Core v1.0.0</span>
        </div>
      </footer>

      {/* Developer Mode Farm Switcher Modal (Strictly 'dev' Account Only) */}
      {isDevUser && (
        <DevFarmSwitcherModal
          open={devModalOpen}
          onClose={() => setDevModalOpen(false)}
          devMode={devMode}
          onToggleDevMode={handleToggleDevMode}
          devFarmId={devFarmId}
          accountFarmId={user?.farmId || user?.farm_id}
          recentFarms={recentDevFarms}
          onSwitchFarm={handleSwitchFarm}
          onResetToAccountFarm={handleResetToAccountFarm}
          feedback={switchFeedback}
        />
      )}
    </div>
  );
}

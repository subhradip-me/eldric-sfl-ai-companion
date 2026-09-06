import { useEffect, useMemo, useRef, useState } from "react";
import { marked } from "marked";
import { api } from "./api.js";

marked.setOptions({ gfm: true, breaks: true });

// Theme context hook
function useTheme() {
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('theme');
    return saved || 'light';
  });

  useEffect(() => {
    localStorage.setItem('theme', theme);
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const toggleTheme = () => setTheme(t => t === 'light' ? 'dark' : 'light');
  
  return { theme, toggleTheme };
}

const fmt = (n, d = 0) => (n == null ? "—" : Number(n).toLocaleString(undefined, { maximumFractionDigits: d }));
const hrs = (m) => (m >= 1440 ? `${(m / 1440).toFixed(1)}d` : `${(m / 60).toFixed(1)}h`);

// markdown -> HTML via marked; styled by .chat-md rules in index.css
const md = (t) => marked.parse(String(t ?? "").trim() || "_⚠️ Empty response — check the server log._");

/* ---------- shared UI (Kretya-style) ---------- */
const Pill = ({ tone = "yellow", children }) => {
  const tones = {
    yellow: "bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-900/20 dark:text-yellow-400 dark:border-[#424242]",
    green: "bg-green-50 text-green-700 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-[#424242]",
    red: "bg-red-50 text-red-600 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-[#424242]",
    blue: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-900/20 dark:text-sky-400 dark:border-[#424242]",
    gray: "bg-slate-50 text-slate-500 border-slate-200 dark:bg-[#303030] dark:text-slate-400 dark:border-[#424242]",
  };
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium border rounded-full px-2.5 py-0.5 ${tones[tone]}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />{children}
    </span>
  );
};

function Stat({ label, value, sub, icon }) {
  return (
    <div className="bg-white dark:bg-[#212121] rounded-2xl border border-slate-200/80 dark:border-[#424242] p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none">
      <div className="flex items-center gap-2 text-xs font-medium text-slate-400 dark:text-slate-400">
        <span className="w-7 h-7 rounded-lg bg-slate-50 dark:bg-[#303030] border border-slate-100 dark:border-[#424242] flex items-center justify-center text-sm">{icon}</span>
        {label}
      </div>
      <div className="text-[26px] font-semibold tracking-tight text-slate-900 dark:text-white mt-2">{value}</div>
      {sub && <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

const Panel = ({ title, right, children }) => (
  <section className="bg-white dark:bg-[#212121] rounded-2xl border border-slate-200/80 dark:border-[#424242] shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none">
    <header className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 dark:border-[#424242]">
      <h2 className="text-sm font-semibold text-slate-900 dark:text-white">{title}</h2>{right}
    </header>
    <div className="p-5">{children}</div>
  </section>
);

/* ---------- Dashboard ---------- */
function Dashboard({ farm, plan }) {
  if (!farm) return <p className="text-slate-400 dark:text-slate-400 text-sm">Loading farm…</p>;
  const pct = Math.min((farm.bumpkin.xp / farm.target.xp) * 100, 100).toFixed(1);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <Stat icon="🧑‍🌾" label="Bumpkin Level" value={farm.bumpkin.level} />
        <Stat icon="⭐" label="Experience" value={fmt(farm.bumpkin.xp)} sub={`${fmt(farm.target.remaining)} to Level 100`} />
        <Stat icon="🌸" label="FLOWER" value={Number(farm.currencies.flowerApprox).toFixed(2)} sub="balance" />
        <Stat icon="🪙" label="Coins" value={fmt(farm.currencies.coins)} />
      </div>
      <Panel title="Road to Level 100" right={<Pill tone="yellow">On Progress · {pct}%</Pill>}>
        <div className="bg-slate-100 dark:bg-[#303030] rounded-full h-2 overflow-hidden">
          <div className="bg-yellow-400 dark:bg-yellow-500 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
      </Panel>
      {plan && !plan.affordable && (
        <div className="bg-white dark:bg-[#212121] border border-slate-200/80 dark:border-[#424242] rounded-2xl p-5 flex items-start gap-3">
          <span className="text-lg">⚠️</span>
          <div>
            <div className="text-sm font-semibold text-slate-900 dark:text-white">Cannot afford current plan</div>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">{plan.notes.join(" ")}</p>
          </div>
        </div>
      )}
      {plan && (
        <div className="grid md:grid-cols-2 gap-4">
          {plan.buildings.map((b) => (
            <div key={b.building} className="bg-white dark:bg-[#212121] rounded-2xl border border-slate-200/80 dark:border-[#424242] p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium text-slate-400 dark:text-slate-400">🏠 {b.building}</span>
                {b.verified ? <Pill tone="green">verified</Pill> : <Pill tone="gray">unverified</Pill>}
              </div>
              <div className="text-[15px] font-semibold text-slate-900 dark:text-white">{b.recipe}</div>
              <div className="flex gap-4 mt-3 text-[13px] text-slate-500 dark:text-slate-400">
                <span>⭐ {fmt(b.batchXp)} XP</span><span>🌸 {b.flowerCost}</span><span>⏱ {hrs(b.totalMinutes)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---------- Planner ---------- */
function Planner({ plan }) {
  if (!plan) return <p className="text-slate-400 dark:text-slate-400 text-sm">Loading…</p>;
  if (plan.error) return <p className="text-red-600 dark:text-red-400 text-sm">{plan.error}</p>;
  return (
    <div className="space-y-5">
      <Panel title="Recipe comparison" right={<Pill tone="blue">best per building</Pill>}>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead><tr className="text-left text-xs text-slate-400 dark:text-slate-400 border-b border-slate-100 dark:border-[#424242]">
              {["Building", "Recipe", "XP/batch", "FLOWER", "XP/FLOWER", "XP/hour", "Time", "Status"].map((h) => <th key={h} className="py-2.5 pr-4 font-medium">{h}</th>)}
            </tr></thead>
            <tbody>{plan.buildings.map((b) => (
              <tr key={b.building} className="border-b border-slate-50 dark:border-[#303030] hover:bg-slate-50/60 dark:hover:bg-[#303030] text-slate-700 dark:text-slate-300">
                <td className="py-3 pr-4 font-semibold text-slate-900 dark:text-white">{b.building}</td><td className="pr-4">{b.recipe}</td>
                <td className="pr-4">{fmt(b.batchXp)}</td><td className="pr-4">{b.flowerCost}</td>
                <td className="pr-4">{isFinite(b.xpPerFlower) ? fmt(b.xpPerFlower) : "∞"}</td>
                <td className="pr-4">{fmt(b.xpPerHour)}</td><td className="pr-4">{hrs(b.totalMinutes)}</td>
                <td>{b.verified ? <Pill tone="green">ok</Pill> : <Pill tone="gray">check</Pill>}</td>
              </tr>))}
            </tbody>
          </table>
        </div>
      </Panel>
      <Panel title="Today's plan">
        <div className="text-sm space-y-2.5 text-slate-600 dark:text-slate-400">
          <div><b className="text-slate-900 dark:text-white font-semibold">🌾 Farm / produce:</b> {plan.farm.join(", ") || "—"}</div>
          <div><b className="text-slate-900 dark:text-white font-semibold">🛒 Buy:</b> {plan.buy.join(", ") || "—"}</div>
          {plan.estimate && <div><b className="text-slate-900 dark:text-white font-semibold">🎯 Level 100:</b> ~{fmt(plan.estimate.batchesNeeded)} × {plan.estimate.recipe} ≈ {fmt(plan.estimate.estimatedFlower)} FLOWER</div>}
          {plan.notes.map((n, i) => <div key={i} className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-[#424242] text-yellow-800 dark:text-yellow-400 rounded-xl px-3.5 py-2.5 text-[13px]">⚠️ {n}</div>)}
        </div>
      </Panel>
    </div>
  );
}

/* ---------- Market ---------- */
function Market({ farm, market }) {
  const [sort, setSort] = useState("value");
  const rows = useMemo(() => {
    if (!farm || !market) return [];
    return Object.entries(market.prices)
      .map(([item, price]) => {
        const qty = farm.inventory[item] ?? 0;
        return { item, price, qty, value: qty * price };
      })
      .sort((a, b) => (sort === "value" ? b.value - a.value : sort === "price" ? b.price - a.price : a.item.localeCompare(b.item)));
  }, [farm, market, sort]);
  if (!farm || !market) return <p className="text-slate-400 dark:text-slate-400 text-sm">Loading…</p>;
  const total = rows.reduce((s, r) => s + r.value, 0);
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div className="bg-white dark:bg-[#212121] border border-slate-200/80 dark:border-[#424242] rounded-2xl px-5 py-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none">
          <div className="text-xs font-medium text-slate-400 dark:text-slate-400">Inventory market value</div>
          <div className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">🌸 {total.toFixed(2)} <span className="text-sm font-medium text-slate-400 dark:text-slate-400">FLOWER</span></div>
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value)}
          className="bg-white dark:bg-[#212121] border border-slate-200 dark:border-[#424242] rounded-xl px-3.5 py-2 text-sm text-slate-600 dark:text-slate-300 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none">
          <option value="value">Sort: total value</option>
          <option value="price">Sort: unit price</option>
          <option value="name">Sort: name</option>
        </select>
      </div>
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {rows.map((r) => (
          <div key={r.item} className={`rounded-2xl border p-4 bg-white dark:bg-[#212121] shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none ${r.qty > 0 ? "border-slate-200/80 dark:border-[#424242]" : "border-slate-100 dark:border-[#303030] opacity-60"}`}>
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-slate-900 dark:text-white">{r.item}</span>
              {r.qty > 0 && r.value >= 0.1 && <Pill tone="green">sellable</Pill>}
            </div>
            <div className="grid grid-cols-3 gap-2 mt-3.5">
              {[["Qty", fmt(r.qty, 2)], ["Unit", r.price], ["Value", r.value.toFixed(3)]].map(([l, v], i) => (
                <div key={l} className="bg-slate-50/80 dark:bg-[#303030] rounded-xl py-2 text-center">
                  <div className="text-[10px] font-medium uppercase tracking-wide text-slate-400 dark:text-slate-400">{l}</div>
                  <div className={`text-[13px] font-semibold ${i === 2 ? "text-yellow-600 dark:text-yellow-500" : "text-slate-800 dark:text-slate-200"}`}>{v}</div>
                </div>))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Activity: observed deltas between snapshots ---------- */
function Activity() {
  const [a, setA] = useState(null);
  useEffect(() => { api.activity().then(setA); }, []);
  if (!a) return <p className="text-slate-400 dark:text-slate-400 text-sm">Loading…</p>;
  if (a.error || a.note) return (
    <div className="bg-white dark:bg-[#212121] border border-slate-200/80 dark:border-[#424242] rounded-2xl p-6 text-sm text-slate-500 dark:text-slate-400">
      📊 {a.note ?? a.error} Activity compares your two most recent snapshots — refresh the farm a couple of times after playing.
    </div>);
  const obs = Object.entries(a.observed ?? {}).sort(([, x], [, y]) => Math.abs(y) - Math.abs(x));
  const inf = Object.entries(a.inferred ?? {}).sort(([, x], [, y]) => Math.abs(y) - Math.abs(x));
  const Delta = ({ v }) => <span className={`font-semibold ${v > 0 ? "text-green-600 dark:text-green-500" : "text-red-500 dark:text-red-400"}`}>{v > 0 ? "+" : ""}{fmt(v, 2)}</span>;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <Stat icon="⭐" label="XP gained" value={fmt(a.xpDelta)} sub="between last two snapshots" />
        <Stat icon="🕒" label="Window" value={a.from && a.to ? `${((a.to - a.from) / 3600000).toFixed(1)}h` : "—"} sub={a.to ? new Date(a.to).toLocaleString() : ""} />
      </div>
      <Panel title="Observed events" right={<Pill tone="green">exact · farmActivity</Pill>}>
        {obs.length === 0 ? <p className="text-sm text-slate-400 dark:text-slate-400">No counter changes.</p> : (
          <div className="grid sm:grid-cols-2 gap-x-8 gap-y-1 text-[13px]">
            {obs.map(([k, v]) => <div key={k} className="flex justify-between border-b border-slate-50 dark:border-[#303030] py-1.5"><span className="text-slate-600 dark:text-slate-400">{k}</span><Delta v={v} /></div>)}
          </div>)}
      </Panel>
      <Panel title="Inventory movement" right={<Pill tone="gray">inferred · cross-check</Pill>}>
        {inf.length === 0 ? <p className="text-sm text-slate-400 dark:text-slate-400">No inventory changes.</p> : (
          <div className="grid sm:grid-cols-2 gap-x-8 gap-y-1 text-[13px]">
            {inf.map(([k, v]) => <div key={k} className="flex justify-between border-b border-slate-50 dark:border-[#303030] py-1.5"><span className="text-slate-600 dark:text-slate-400">{k}</span><Delta v={v} /></div>)}
          </div>)}
      </Panel>
    </div>
  );
}

/* ---------- Quests: chore board / deliveries / bounties ---------- */
function Quests({ farm }) {
  if (!farm) return <p className="text-slate-400 dark:text-slate-400 text-sm">Loading…</p>;
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
    <div className="space-y-5">
      <Panel title="Chore Board" right={<Pill tone="yellow">{chores.filter(([, c]) => c.completedAt).length}/{chores.length} done</Pill>}>
        <div className="grid md:grid-cols-2 gap-3">
          {chores.map(([npc, c]) => (
            <div key={npc} className={`rounded-xl border p-3.5 ${c.completedAt ? "border-green-200 dark:border-[#424242] bg-green-50/40 dark:bg-green-900/10" : "border-slate-200/80 dark:border-[#424242] bg-white dark:bg-[#212121]"}`}>
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-semibold text-slate-900 dark:text-white capitalize">{npc}</span>
                {c.completedAt ? <Pill tone="green">done</Pill> : <Pill tone="gray">open</Pill>}
              </div>
              <div className="text-[13px] text-slate-600 dark:text-slate-400 mt-1">{c.name}</div>
              <div className="text-xs text-slate-400 dark:text-slate-400 mt-1.5">Reward: {reward(c.reward)}</div>
            </div>))}
        </div>
      </Panel>
      <Panel title="Deliveries" right={<Pill tone="yellow">{deliveries.filter((d) => d.completedAt).length}/{deliveries.length} done</Pill>}>
        <div className="space-y-2">
          {deliveries.map((d) => (
            <div key={d.id} className={`flex items-center justify-between rounded-xl border px-3.5 py-2.5 text-[13px] ${d.completedAt ? "border-green-200 dark:border-[#424242] bg-green-50/40 dark:bg-green-900/10" : "border-slate-200/80 dark:border-[#424242]"}`}>
              <div>
                <span className="font-semibold text-slate-900 dark:text-white capitalize">{d.from}</span>
                <span className="text-slate-500 dark:text-slate-400 ml-2">{Object.entries(d.items).map(([k, v]) => `${fmt(v)}× ${k}`).join(", ")}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-400 dark:text-slate-400">{reward(d.reward)}</span>
                {d.completedAt ? <Pill tone="green">done</Pill> : <Pill tone="gray">open</Pill>}
              </div>
            </div>))}
        </div>
      </Panel>
      <Panel title="Bounties (animals & feathers)" right={<Pill tone="blue">{doneBounties.size} claimed</Pill>}>
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {bounties.map((b) => (
            <div key={b.id} className={`rounded-xl border p-3.5 text-[13px] ${doneBounties.has(b.id) ? "border-green-200 dark:border-[#424242] bg-green-50/40 dark:bg-green-900/10" : "border-slate-200/80 dark:border-[#424242]"}`}>
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-900 dark:text-white">{b.name}{b.level ? ` · Lv ${b.level}` : ""}</span>
                {doneBounties.has(b.id) ? <Pill tone="green">claimed</Pill> : <Pill tone="gray">open</Pill>}
              </div>
              <div className="text-xs text-slate-400 dark:text-slate-400 mt-1">Reward: {reward(b)}</div>
            </div>))}
        </div>
      </Panel>
    </div>
  );
}

/* ---------- History: saved chat sessions ---------- */
function History({ onResume }) {
  const [sessions, setSessions] = useState(null);
  const [active, setActive] = useState(null); // {id, msgs}
  useEffect(() => { api.sessions().then(setSessions); }, []);
  if (!sessions) return <p className="text-slate-400 dark:text-slate-400 text-sm">Loading…</p>;
  if (sessions.error) return <p className="text-red-600 dark:text-red-400 text-sm">{sessions.error} (is Postgres running?)</p>;
  if (active)
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={() => setActive(null)} className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors">← All sessions</button>
          <button
            onClick={() => onResume(active.id, active.msgs)}
            className="ml-auto flex items-center gap-1.5 text-sm font-medium bg-yellow-400 hover:bg-yellow-500 text-slate-900 rounded-xl px-4 py-1.5 transition-colors shadow-sm"
          >
            ↩ Resume in Chat
          </button>
        </div>
        <Panel
          title={`Session · ${new Date(Number(active.msgs[0]?.created_at)).toLocaleString()}`}
          right={<Pill tone="blue">{active.msgs.length} messages</Pill>}
        >
          <div className="space-y-3">
            {active.msgs.map((m, i) => m.role === "user" ? (
              <div key={i} className="text-sm rounded-2xl rounded-br-md px-4 py-2.5 bg-yellow-100 dark:bg-yellow-900/20 text-slate-900 dark:text-white ml-16 w-fit max-w-[80%] justify-self-end">{m.content}</div>
            ) : (
              <div key={i} className="chat-md text-[13px] leading-relaxed rounded-2xl rounded-bl-md px-4 py-3 bg-slate-50 dark:bg-[#303030] border border-slate-200/70 dark:border-[#424242] text-slate-600 dark:text-slate-300 mr-16 max-w-[85%]"
                dangerouslySetInnerHTML={{ __html: md(m.content) }} />
            ))}
          </div>
        </Panel>
      </div>
    );
  return (
    <Panel title="Chat history" right={<Pill tone="gray">{sessions.length} sessions</Pill>}>
      {sessions.length === 0 ? <p className="text-sm text-slate-400 dark:text-slate-400">No saved conversations yet — talk to the Farm Assistant.</p> : (
        <div className="space-y-2">
          {sessions.map((s) => (
            <div key={s.session_id} className="group rounded-xl border border-slate-200/80 dark:border-[#424242] hover:border-slate-300 dark:hover:border-[#303030] hover:bg-slate-50/60 dark:hover:bg-[#303030] px-4 py-3 transition-colors">
              <button
                className="w-full text-left"
                onClick={() => api.session(s.session_id).then((msgs) => setActive({ id: s.session_id, msgs }))}
              >
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-slate-900 dark:text-white truncate">{s.first_message?.slice(0, 72) || "(empty)"}</span>
                  <Pill tone="blue">{s.messages} msgs</Pill>
                </div>
                <div className="text-xs text-slate-400 dark:text-slate-400 mt-1">{new Date(Number(s.started_at)).toLocaleString()} → {new Date(Number(s.last_at)).toLocaleTimeString()}</div>
              </button>
              <button
                onClick={() => api.session(s.session_id).then((msgs) => onResume(s.session_id, msgs))}
                className="mt-2 text-[11px] font-medium text-yellow-600 dark:text-yellow-500 hover:text-yellow-700 dark:hover:text-yellow-400 transition-colors opacity-0 group-hover:opacity-100"
              >
                ↩ Resume in Chat →
              </button>
            </div>
          ))}
        </div>)}
    </Panel>
  );
}

/* ---------- Chat panel (floating) ---------- */
const NEW_SESSION = () => crypto.randomUUID();
function ChatPanel({ open, onToggle, sessionId, msgs, setMsgs }) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [wide, setWide] = useState(false);
  const isResumed = msgs.some((m) => m.role === "history");
  const endRef = useRef(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }); }, [msgs, busy]);
  const quick = ["What should I do today?", "Current bottleneck?", "FLOWER to Level 100?", "What do I need for my next expansion?"];
  const send = async (text) => {
    setMsgs((m) => [...m, { role: "you", text }]); setInput(""); setBusy(true);
    try { const r = await api.chat(text, sessionId); setMsgs((m) => [...m, { role: "ai", text: r.answer ?? r.error, steps: r.steps }]); }
    finally { setBusy(false); }
  };
  if (!open)
    return (
      <button onClick={onToggle} title="Open Farm Assistant"
        className="fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-yellow-400 hover:bg-yellow-500 text-2xl shadow-lg shadow-yellow-400/30 border border-yellow-300 flex items-center justify-center transition-transform hover:scale-105">
        <img 
          src="https://animations.sunflower-land.com/animated_webp/0_v1_32_1_5_185_46_22_240_395_0_228_0_0_0_0_0_266/idle-small" 
          alt="Farm Assistant"
          className="w-10 h-10 object-cover"
        />
      </button>
    );
  return (
    <div className={`fixed bottom-6 right-6 z-50 ${wide ? "w-[42rem] max-w-[calc(100vw-3rem)] h-[80vh]" : "w-[24rem] max-w-[calc(100vw-3rem)] h-[34rem] max-h-[80vh]"}
      bg-white dark:bg-[#212121] rounded-2xl border border-slate-200 dark:border-[#424242] shadow-2xl shadow-slate-900/15 dark:shadow-black/50 flex flex-col min-h-0 overflow-hidden transition-all duration-200`}>
      <header className="px-4 py-3 border-b border-slate-100 dark:border-[#424242] flex items-center gap-2.5 shrink-0 bg-slate-50/60 dark:bg-[#212121]">
        <span className="w-8 h-8 rounded-xl bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-100 dark:border-[#424242] flex items-center justify-center">🌻</span>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-slate-900 dark:text-white">Farm Assistant</div>
          <div className="text-[11px] text-slate-400 dark:text-slate-400 truncate">
            {isResumed ? <span className="text-yellow-600 dark:text-yellow-500 font-medium">↩ Resumed session</span> : "Groq · explains the numbers"}
          </div>
        </div>
        {isResumed && (
          <button
            title="Start a new session"
            onClick={() => setMsgs([])}
            className="text-[11px] font-medium text-slate-400 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300 border border-slate-200 dark:border-[#424242] rounded-lg px-2 py-0.5 transition-colors"
          >
            + New
          </button>
        )}
        <Pill tone={isResumed ? "yellow" : "green"}>{isResumed ? "resumed" : "online"}</Pill>
        <button onClick={() => setWide(!wide)} title={wide ? "Shrink" : "Expand"}
          className="ml-1 w-7 h-7 rounded-lg hover:bg-slate-200/70 dark:hover:bg-[#303030] text-slate-400 dark:text-slate-400">{wide ? "⤡" : "⤢"}</button>
        <button onClick={onToggle} title="Minimize" className="w-7 h-7 rounded-lg hover:bg-slate-200/70 dark:hover:bg-[#303030] text-slate-400 dark:text-slate-400">—</button>
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
        {msgs.length === 0 && (
          <div className="space-y-2">
            <p className="text-xs text-slate-400 dark:text-slate-400">Ask me anything about your farm:</p>
            {quick.map((q) => (
              <button key={q} onClick={() => send(q)}
                className="block w-full text-left text-[13px] bg-white dark:bg-[#303030] hover:bg-slate-50 dark:hover:bg-[#424242] border border-slate-200 dark:border-[#424242] rounded-xl px-3.5 py-2.5 text-slate-600 dark:text-slate-300 shadow-[0_1px_2px_rgba(15,23,42,0.04)] dark:shadow-none">{q}</button>))}
          </div>)}
        {msgs.map((m, i) => {
          if (m.role === "history") return (
            <div key={i} className="flex items-center gap-2 py-1">
              <div className="flex-1 h-px bg-slate-200 dark:bg-[#424242]" />
              <span className="text-[10px] font-medium text-slate-400 dark:text-slate-400 shrink-0">↩ Resumed from {new Date(m.at).toLocaleString()}</span>
              <div className="flex-1 h-px bg-slate-200 dark:bg-[#424242]" />
            </div>
          );
          return m.role === "you" ? (
            <div key={i} className="text-sm rounded-2xl rounded-br-md px-4 py-2.5 bg-yellow-100 dark:bg-yellow-900/20 text-slate-900 dark:text-white ml-8">{m.text}</div>
          ) : (
            <div key={i} className="mr-4 space-y-1.5">
              {m.steps?.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {m.steps.map((s, si) => (
                    <span key={si} className={`text-[10px] font-medium rounded-full px-2 py-0.5 border ${s.ok ? "bg-slate-50 dark:bg-[#303030] text-slate-500 dark:text-slate-400 border-slate-200 dark:border-[#424242]" : "bg-red-50 dark:bg-red-900/10 text-red-500 dark:text-red-400 border-red-200 dark:border-[#424242]"}`}>
                      🔧 {s.tool}
                    </span>))}
                </div>)}
              <div className="chat-md text-[13px] leading-relaxed rounded-2xl rounded-bl-md px-4 py-3 bg-slate-50 dark:bg-[#303030] border border-slate-200/70 dark:border-[#424242] text-slate-600 dark:text-slate-300"
                dangerouslySetInnerHTML={{ __html: md(m.text) }} />
            </div>
          );
        })}
        {busy && <div className="text-xs text-slate-400 dark:text-slate-400">🌻 planning · gathering data · checking…</div>}
        <div ref={endRef} className="h-px" />
      </div>
      <form onSubmit={(e) => { e.preventDefault(); if (input.trim() && !busy) send(input); }}
        className="p-3 border-t border-slate-100 dark:border-[#424242] flex gap-2 shrink-0">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Message…"
          className="flex-1 bg-slate-50 dark:bg-[#303030] border border-slate-200 dark:border-[#424242] rounded-xl px-3.5 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 dark:placeholder:text-slate-400 outline-none focus:border-yellow-300 dark:focus:border-yellow-600 focus:bg-white dark:focus:bg-[#212121]" />
        <button disabled={busy} className="bg-yellow-400 hover:bg-yellow-500 disabled:opacity-50 text-slate-900 font-medium rounded-xl px-3.5">➤</button>
      </form>
    </div>
  );
}

/* ---------- App shell ---------- */
const NAV = [
  { id: "Dashboard", icon: "🏡" },
  { id: "Planner", icon: "🗺️" },
  { id: "Market", icon: "💰" },
  { id: "Activity", icon: "📊" },
  { id: "Quests", icon: "📜" },
  { id: "History", icon: "🗂️" },
];

export default function App() {
  const [tab, setTab] = useState("Dashboard");
  const [navOpen, setNavOpen] = useState(true);
  const [chatOpen, setChatOpen] = useState(true);
  const [farm, setFarm] = useState(null);
  const [plan, setPlan] = useState(null);
  const [market, setMarket] = useState(null);
  const { theme, toggleTheme } = useTheme();

  // Chat state lifted here so History can resume a session into the panel
  const [sessionId, setSessionId] = useState(() => NEW_SESSION());
  const [msgs, setMsgs] = useState([]);

  const handleResume = (id, historyMsgs) => {
    // Map DB rows to chat-panel format; inject a divider marker
    const converted = historyMsgs.map((m) => ({
      role: m.role === "user" ? "you" : "ai",
      text: m.content,
    }));
    setSessionId(id);
    setMsgs([{ role: "history", at: Number(historyMsgs[0]?.created_at) || Date.now() }, ...converted]);
    setChatOpen(true);
  };

  const load = () => { api.farm().then(setFarm); api.planner().then(setPlan); api.market().then(setMarket); };
  useEffect(load, []);
  return (
    <div className="h-screen flex bg-[#f6f7f9] dark:bg-[#000000] text-slate-600 dark:text-slate-400 font-sans antialiased">
      {/* left sidebar (collapsible) */}
      <aside className={`${navOpen ? "w-60" : "w-16"} shrink-0 bg-white dark:bg-[#212121] border-r border-slate-200 dark:border-[#424242] flex flex-col transition-all duration-200`}>
        <div className={`py-4 border-b border-slate-100 dark:border-[#424242] flex items-center gap-2.5 ${navOpen ? "px-5" : "justify-center"}`}>
          <span className="w-9 h-9 rounded-xl bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-100 dark:border-[#424242] flex items-center justify-center text-lg shrink-0">🌻</span>
          {navOpen && (
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-slate-900 dark:text-white truncate">Sunflower AI</div>
              <div className="text-[11px] text-slate-400 dark:text-slate-400">Farm Command Center</div>
            </div>)}
          <button onClick={() => setNavOpen(!navOpen)} title="Toggle sidebar"
            className={`w-6 h-6 rounded-md hover:bg-slate-100 dark:hover:bg-[#303030] text-slate-400 dark:text-slate-400 text-xs ${navOpen ? "" : "hidden"}`}>«</button>
        </div>
        {!navOpen && (
          <button onClick={() => setNavOpen(true)} className="mx-auto mt-3 w-8 h-8 rounded-lg hover:bg-slate-100 dark:hover:bg-[#303030] text-slate-400 dark:text-slate-400">»</button>
        )}
        {navOpen && <div className="px-5 pt-4 pb-1 text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-400">Workspace</div>}
        <nav className={`flex-1 space-y-1 ${navOpen ? "p-3" : "p-2 pt-3"}`}>
          {NAV.map((n) => (
            <button key={n.id} onClick={() => setTab(n.id)} title={n.id}
              className={`w-full flex items-center gap-3 rounded-xl text-sm transition-colors ${navOpen ? "px-4 py-2.5" : "justify-center py-2.5"} ${tab === n.id
                ? "bg-slate-900 dark:bg-[#303030] text-white font-medium shadow-sm" : "hover:bg-slate-50 dark:hover:bg-[#303030] text-slate-500 dark:text-slate-400"}`}>
              <span>{n.icon}</span>{navOpen && n.id}
            </button>))}
        </nav>
        <div className={`border-t border-slate-100 dark:border-[#424242] ${navOpen ? "p-3" : "p-2"} space-y-2`}>
          <button onClick={toggleTheme} title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
            className={`w-full text-sm font-medium bg-slate-100 dark:bg-[#303030] hover:bg-slate-200 dark:hover:bg-[#424242] text-slate-700 dark:text-slate-300 rounded-xl py-2 ${navOpen ? "px-3" : "px-0"} transition-colors`}>
            {navOpen ? (theme === 'light' ? '🌙 Dark Mode' : '☀️ Light Mode') : (theme === 'light' ? '🌙' : '☀️')}
          </button>
          <button onClick={load} title="Refresh data"
            className={`w-full text-sm font-medium bg-yellow-400 hover:bg-yellow-500 text-slate-900 rounded-xl py-2 ${navOpen ? "px-3" : "px-0"}`}>
            {navOpen ? "🔄 Refresh data" : "🔄"}
          </button>
          {navOpen && (
            <div className="text-[11px] text-slate-400 dark:text-slate-400 mt-3 px-1">
              {farm ? <>Farm <b className={farm.stale ? "text-yellow-600 dark:text-yellow-500" : "text-green-600 dark:text-green-500"}>{farm.stale ? "stale" : "live"}</b> · Level {farm.bumpkin.level}</> : "connecting…"}
            </div>)}
        </div>
      </aside>
      {/* center */}
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto p-7">
          <div className="text-xs text-slate-400 dark:text-slate-400 mb-1">Farm <span className="mx-1">›</span> {farm?.bumpkin ? `SUBHRADiP` : "…"} <span className="mx-1">›</span> <span className="text-slate-600 dark:text-slate-400 font-medium">{tab}</span></div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-900 dark:text-white mb-6">{NAV.find((n) => n.id === tab)?.icon} {tab}</h1>
          {tab === "Dashboard" && <Dashboard farm={farm} plan={plan} />}
          {tab === "Planner" && <Planner plan={plan} />}
          {tab === "Market" && <Market farm={farm} market={market} />}
          {tab === "Activity" && <Activity />}
          {tab === "Quests" && <Quests farm={farm} />}
          {tab === "History" && <History onResume={handleResume} />}
        </div>
      </main>
      {/* floating chat window */}
      <ChatPanel
        open={chatOpen}
        onToggle={() => setChatOpen(!chatOpen)}
        sessionId={sessionId}
        msgs={msgs}
        setMsgs={setMsgs}
      />
    </div>
  );
}

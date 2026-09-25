import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { dashboardAPI } from "../services/api";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import CurrencyIcon from "../components/common/CurrencyIcon";
import {
  IconChartLineUp,
  IconDiceFive,
  IconStack,
  IconTrophy as TrophyIcon,
  IconPulse,
  IconCaretDown,
  IconWarningCircle,
} from "../components/common/Icons";
import styles from "./Dashboard.module.css";

// posters for Performance by Game thumbs
import flipPoster from "../assets/game-posters/flip.png";
import dicePoster from "../assets/game-posters/dice.png";
import limboPoster from "../assets/game-posters/limbo.png";
import plinkoPoster from "../assets/game-posters/plinko.png";
import crashPoster from "../assets/game-posters/crash.png";
import minesPoster from "../assets/game-posters/mines.png";
import roulettePoster from "../assets/game-posters/roulette.png";
import blackjackPoster from "../assets/game-posters/blackjack.png";
import kenoPoster from "../assets/game-posters/keno.png";
import towerPoster from "../assets/game-posters/tower.png";
import russianRoulettePoster from "../assets/game-posters/RussianRoulette.png";
import wheelPoster from "../assets/game-posters/wheel.png";
import snakesPoster from "../assets/game-posters/snakes.png";
import rpsPoster from "../assets/game-posters/rps.png";
import fallbackPoster from "../assets/game-posters/fallback.png";

function getGamePoster(name) {
  const posters = {
    flip: flipPoster,
    dice: dicePoster,
    limbo: limboPoster,
    plinko: plinkoPoster,
    crash: crashPoster,
    mines: minesPoster,
    roulette: roulettePoster,
    blackjack: blackjackPoster,
    keno: kenoPoster,
    tower: towerPoster,
    russian_roulette: russianRoulettePoster,
    wheel: wheelPoster,
    snakes: snakesPoster,
    rps: rpsPoster,
    fallback: fallbackPoster,
  };
  return posters[name] || fallbackPoster;
}

const TF_OPTIONS = [
  { value: "24h", label: "24H" },
  { value: "168h", label: "7D" },
  { value: "720h", label: "30D" },
  { value: "all", label: "ALL" },
];

function fmtMoney(n, decimals = 2) {
  const num = Number(n ?? 0);
  const sign = num < 0 ? "-" : "";
  const abs = Math.abs(num);
  return `${sign}$${abs.toFixed(decimals)}`;
}
function fmtMoneySigned(n, decimals = 2) {
  const num = Number(n ?? 0);
  const sign = num > 0 ? "+" : num < 0 ? "-" : "";
  const abs = Math.abs(num);
  return `${sign}$${abs.toFixed(decimals)}`;
}
function fmtNum(n) {
  const num = Number(n ?? 0);
  if (Math.abs(num) >= 1e9) return `${(num / 1e9).toFixed(2)}B`;
  if (Math.abs(num) >= 1e6) return `${(num / 1e6).toFixed(2)}M`;
  if (Math.abs(num) >= 1e3) return `${(num / 1e3).toFixed(1)}K`;
  return String(num);
}
function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}
function profitClass(n) {
  const v = Number(n);
  if (v > 0) return styles.profitPos;
  if (v < 0) return styles.profitNeg;
  return "";
}

function MoneyWithIcon({ value }) {
  const v = Number(value ?? 0);
  const isPos = v > 0;
  const isNeg = v < 0;
  const abs = `$${Math.abs(v).toFixed(2)}`;
  return (
    <span className={isPos ? styles.profitPos : isNeg ? styles.profitNeg : ""} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span className={styles.profitIcon} aria-hidden>{isPos ? "+" : isNeg ? "−" : ""}</span>
      {abs}
    </span>
  );
}

function EmptyState({ icon, title, text, actionLabel, onAction, secondary }) {
  return (
    <div className={styles.emptyWrap}>
      <div className={styles.emptyIcon} aria-hidden>{icon}</div>
      <div className={styles.emptyTitle}>{title}</div>
      <div className={styles.emptyText}>{text}</div>
      {actionLabel && (
        <div className={styles.emptyAction}>
          <button type="button" className={secondary ? styles.secondaryActionBtn : styles.emptyActionBtn} onClick={onAction}>
            {actionLabel}
          </button>
        </div>
      )}
    </div>
  );
}

/* Filled icons (components/common/Icons.jsx) */
const IconChart = <IconChartLineUp />;
const IconDice = <IconDiceFive />;
const IconLayers = <IconStack />;
const IconTrophy = <TrophyIcon />;
const IconActivity = <IconPulse />;
const ChevronIcon = <IconCaretDown size={18} />;

function Panel({ id, title, collapsed, onToggle, headerAction, children }) {
  const isCollapsed = collapsed[id];
  return (
    <div className={`${styles.panel} ${isCollapsed ? styles.panelCollapsed : ""}`}>
      <div className={styles.panelHeaderWrap} onClick={() => onToggle(id)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onToggle(id); }} aria-expanded={!isCollapsed} aria-controls={`panel-${id}`}>
        <div className={styles.panelHeader}>
          <h2>{title}</h2>
        </div>
        <div className={styles.panelActions} onClick={(e) => e.stopPropagation()}>
          {headerAction}
          <span className={styles.panelChevron} aria-hidden>{ChevronIcon}</span>
        </div>
      </div>
      <div className={styles.panelBody} id={`panel-${id}`}>
        {children}
      </div>
    </div>
  );
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload || !payload.length) return null;
  const v = payload[0]?.value;
  const isPos = Number(v) >= 0;
  return (
    <div
      style={{
        background: "var(--color-bg-input)",
        border: "1px solid var(--color-border-input)",
        borderRadius: "8px",
        padding: "10px 12px",
        boxShadow: "none",
        minWidth: 140,
      }}
    >
      <div style={{ color: "var(--color-text-secondary)", fontWeight: 700, fontSize: 17, marginBottom: 4 }}>{label}</div>
      <div style={{ color: isPos ? "var(--accent-green)" : "var(--accent-red)", fontWeight: 800, fontSize: 17, display: "flex", alignItems: "center", gap: 6 }}>
        <span aria-hidden>{isPos ? "+" : "−"}</span>{`$${Math.abs(Number(v)).toFixed(2)}`}
      </div>
    </div>
  );
}

function PieTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0];
  return (
    <div
      style={{
        background: "var(--color-bg-input)",
        border: "1px solid var(--color-border-input)",
        borderRadius: "8px",
        padding: "10px 12px",
        boxShadow: "none",
      }}
    >
      <div style={{ color: "#ffffff", fontWeight: 800, fontSize: 17, display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ width: 10, height: 10, borderRadius: 2, background: p.payload?.fill || p.color }} />
        {p.name}: {fmtMoney(p.value)}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { isAuthenticated, user } = useAuth();
  const navigate = useNavigate();
  const [timeframe, setTimeframe] = useState("24h");
  const [data, setData] = useState(null);
  const [biggestWins, setBiggestWins] = useState([]);
  const [profitChart, setProfitChart] = useState([]);
  const [timeline, setTimeline] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [collapsed, setCollapsed] = useState({});
  const [visibleRecent, setVisibleRecent] = useState(6);
  const [visibleWins, setVisibleWins] = useState(5);
  const [visiblePerf, setVisiblePerf] = useState(8);
  const [hourlyDate, setHourlyDate] = useState(null);

  const toggle = (id) => setCollapsed((m) => ({ ...m, [id]: !m[id] }));

  const fetchDashboard = async (tf) => {
    setError(null);
    setLoading(true);
    try {
      const [dashRes, winsRes, chartRes, tlRes] = await Promise.all([
        dashboardAPI.getUserDashboard({ timeframe: tf }),
        dashboardAPI.getBiggestWins({ limit: 5 }).catch(() => ({ data: { data: [] } })),
        dashboardAPI.getProfitChart({ timeframe: tf }).catch(() => ({ data: { data: [] } })),
        dashboardAPI.getActivityTimeline({ hours: tf === "all" ? 168 : parseInt(tf) || 24 }).catch(() => ({ data: { data: [] } })),
      ]);
      const d = dashRes?.data?.data ?? null;
      setData(d);
      setBiggestWins(winsRes?.data?.data ?? []);
      setProfitChart(chartRes?.data?.data ?? []);
      setTimeline(tlRes?.data?.data ?? []);
    } catch (e) {
      setError(e?.response?.data?.message || e.message || "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    fetchDashboard(timeframe);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeframe, isAuthenticated]);

  const gaming = data?.gaming;
  const customBets = data?.customBets;
  const breakdown = data?.gameBreakdown ?? [];
  const recentRounds = data?.recentActivity?.rounds ?? [];
  const recentCustom = data?.recentActivity?.customBets ?? [];

  const username = user?.username || user?.email?.split("@")[0] || "player";
  const balance = Number(data?.balance ?? user?.balance ?? 0);

  const kpis = useMemo(() => {
    if (!data || !gaming) return [];
    const bal = balance;
    const net = Number(gaming.net_profit ?? 0);
    const wagered = Number(gaming.total_wagered ?? 0);
    const rounds = Number(gaming.total_rounds ?? 0);
    const winRate = Number(gaming.win_rate ?? 0);
    const biggest = Number(gaming.biggest_win ?? 0);
    return [
      { key: "balance", label: "Balance", valueNode: <span style={{ color: "#ffffff" }}>{fmtMoney(bal)}</span>, sub: `${rounds} rounds` },
      { key: "net", label: "Net Profit", valueNode: <MoneyWithIcon value={net} />, sub: net >= 0 ? "Up this period" : "Down this period" },
      { key: "wagered", label: "Total Wagered", valueNode: <span style={{ color: "#ffffff" }}>{fmtMoney(wagered)}</span>, sub: `Avg ${rounds ? fmtMoney(wagered / rounds) : "$0.00"} / bet` },
      { key: "winrate", label: "Win Rate", valueNode: <span style={{ color: winRate >= 50 ? "var(--accent-green)" : "var(--accent-red)" }}>{winRate}%</span>, sub: `${gaming.wins ?? 0}W — ${gaming.losses ?? 0}L` },
      { key: "biggest", label: "Biggest Win", valueNode: <MoneyWithIcon value={biggest} />, sub: biggest ? "Best payout" : "No wins yet" },
      { key: "payout", label: "Total Payout", valueNode: <span style={{ color: "#ffffff" }}>{fmtMoney(gaming.total_payout)}</span>, sub: "Returned to you" },
    ];
  }, [data, gaming, balance]);

  const areaData = useMemo(() => {
    if (!profitChart || profitChart.length === 0) return [];
    const slice = profitChart.slice(-28);
    return slice.map((p, i) => ({
      idx: i,
      cum: Number(p.cumulative_profit ?? p.profit ?? 0),
      profit: Number(p.profit ?? 0),
      label: p.timestamp ? new Date(p.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : `#${i + 1}`,
      raw: p.timestamp ?? p.created_at ?? `#${i + 1}`,
    }));
  }, [profitChart]);

  const chartBars = useMemo(() => {
    if (!profitChart || profitChart.length === 0) return [];
    return profitChart.slice(-20);
  }, [profitChart]);

  const lastCum = areaData.length ? areaData[areaData.length - 1].cum : 0;
  const isProfitPositive = Number(lastCum) >= 0;
  const chartColor = isProfitPositive ? "var(--accent-green)" : "var(--accent-red)";
  const chartGradId = isProfitPositive ? "dashGreen" : "dashRed";

  const pieData = useMemo(() => {
    if (!breakdown || breakdown.length === 0) return [];
    return breakdown
      .map((r) => ({ name: r.display_name ?? r.name ?? "Game", value: Number(r.wagered ?? r.total_wagered ?? 0) || 0 }))
      .filter((d) => d.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 6);
  }, [breakdown]);

  const PIE_COLORS = ["#2377ff", "#00e701", "#ff9f00", "#FB7984", "#3E586C", "#A1BFD6"];

  const totalBetsCount = Number(gaming?.total_rounds ?? 0) + Number(customBets?.total_bets ?? customBets?.participated ?? 0);

  if (!isAuthenticated) {
    return (
      <div className={styles.page}>
        <div className={styles.shell}>
          <div className={styles.panel}>
            <div className={styles.panelHeaderWrap} style={{ cursor: "default" }}>
              <div className={styles.panelHeader}><h2>Dashboard</h2></div>
            </div>
            <div className={styles.panelBody} style={{ alignItems: "center", textAlign: "center" }}>
              <p style={{ color: "var(--color-text-secondary)", fontSize: 17 }}>Please login to view your personal casino dashboard.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className={styles.page}>
        <div className={styles.shell}>
          <div className={styles.loading}>
            <div className={styles.spinner} />
            <div>Loading your dashboard…</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        {/* HERO — image correctly centered, text white, no blue/orange */}
        <div className={styles.hero}>
          <div className={styles.heroTop}>
            <div className={styles.heroWelcome}>
              <div className={styles.heroEyebrow}>Dashboard</div>
              <h1 className={styles.heroTitle}>Welcome back, <span>{username}</span></h1>
              <div className={styles.heroSub}>Your bets, profit and recent activity — tracked per account.</div>
            </div>
            <div className={styles.heroBalanceBlock}>
              <div className={styles.heroBalanceLabel}>Balance</div>
              <div className={styles.heroBalanceValue}>{balance.toFixed(2)}<CurrencyIcon className={styles.cur} /></div>
              <div style={{ fontSize: 17, fontWeight: 600, color: "var(--color-text-secondary)" }}>
                {totalBetsCount ? `${fmtNum(totalBetsCount)} bets placed` : "No bets yet"}
              </div>
            </div>
          </div>
        </div>

        <div className={styles.timeframeRow}>
          <div className={styles.timeframeLabel}>Timeframe</div>
          <div className={styles.timeframeToggle} role="tablist" aria-label="Timeframe">
            {TF_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                role="tab"
                aria-selected={timeframe === o.value}
                className={`${styles.tfBtn} ${timeframe === o.value ? styles.tfActive : ""}`}
                onClick={() => setTimeframe(o.value)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <div className={styles.error} role="alert">
            <span className="ui-page-error-icon" aria-hidden>
              <IconWarningCircle />
            </span>
            <span><span className="ui-page-error-title">Couldn’t load dashboard.</span><span className="ui-page-error-message">{error}</span></span>
          </div>
        )}

        {/* KPI — header #152430, values 17px, no orange */}
        <div className={styles.kpiGrid}>
          {kpis.map((k) => (
            <div key={k.key} className={styles.kpiCard}>
              <div className={styles.kpiHeader}><div className={styles.kpiLabel}>{k.label}</div></div>
              <div className={styles.kpiBody}>
                <div className={styles.kpiValue}>{k.valueNode}</div>
                <div className={styles.kpiSub}>{k.sub}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Profit Timeline — RED/GREEN, bigger, overlay pills, no horizontal lines, readonly tooltip */}
        <Panel id="profit" title="Profit Timeline" collapsed={collapsed} onToggle={toggle} headerAction={<button type="button" className={styles.refreshTopBtn} onClick={(e) => { e.stopPropagation(); fetchDashboard(timeframe); }}>Refresh</button>}>
          {areaData.length === 0 ? (
            <EmptyState icon={IconChart} title="No chart data yet" text="Place a few bets to populate your profit curve. Every bet updates this timeline." />
          ) : (
            <>
              <div className={styles.chartWrap}>
                <div className={styles.chartOverlayTop} aria-hidden>
                  <span className={styles.chartOverlayPill} style={{ color: isProfitPositive ? "var(--accent-green)" : "var(--accent-red)" }}>
                    Current: {fmtMoneySigned(lastCum)}
                  </span>
                </div>
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={areaData} margin={{ left: 0, right: 8, top: 36, bottom: 0 }}>
                    <defs>
                      <linearGradient id="dashGreen" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--accent-green)" stopOpacity={0.30} />
                        <stop offset="100%" stopColor="var(--accent-green)" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="dashRed" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--accent-red)" stopOpacity={0.28} />
                        <stop offset="100%" stopColor="var(--accent-red)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    {/* no horizontal lines — flat, content-carries */}
                    <XAxis
                      dataKey="label"
                      tick={{ fill: "var(--color-text-secondary)", fontSize: 16, fontWeight: 600 }}
                      axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                      tickLine={false}
                      interval="preserveStartEnd"
                      minTickGap={20}
                      padding={{ left: 6, right: 6 }}
                    />
                    <YAxis
                      tick={{ fill: "var(--color-text-secondary)", fontSize: 16, fontWeight: 600 }}
                      axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
                      tickLine={false}
                      width={62}
                      tickFormatter={(v) => fmtMoney(v)}
                    />
                    <Tooltip content={<CustomTooltip />} cursor={{ stroke: "rgba(255,255,255,0.14)", strokeWidth: 1 }} isAnimationActive={false} animationDuration={0} />
                    <Area type="monotone" dataKey="cum" stroke={chartColor} strokeWidth={2.4} fill={`url(#${chartGradId})`} dot={false} activeDot={{ r: 3.5, fill: chartColor, stroke: "#ffffff", strokeWidth: 1.5 }} isAnimationActive={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              {timeline.length > 0 && (() => {
                const dates = Array.from(new Set(timeline.map(h => String(h.hour).slice(0, 10))));
                const activeDate = hourlyDate || dates[0];
                const filtered = timeline.filter(h => String(h.hour).startsWith(activeDate));
                const display = filtered.slice(-6);
                return (
                  <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", paddingTop: 16 }}>
                    <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: 0.2, textTransform: "uppercase", color: "var(--color-text-secondary)", marginBottom: 12 }}>Hourly activity</div>
                    <div className={styles.hourlyDateToggle} role="tablist" aria-label="Hourly date">
                      {dates.map(d => (
                        <button key={d} type="button" role="tab" aria-selected={activeDate === d} className={`${styles.hourlyDateBtn} ${activeDate === d ? styles.hourlyDateBtnActive : ""}`} onClick={() => setHourlyDate(d)}>{d}</button>
                      ))}
                    </div>
                    <div className={styles.hourlyGrid}>
                      {display.map((h) => {
                        const timeOnly = String(h.hour).slice(11, 16) || String(h.hour);
                        return (
                          <div key={h.hour} className={styles.hourlyCard}>
                            <div className={styles.hourlyCardTop}>
                              <span className={styles.hourlyBets}>{h.bet_count} bets</span>
                              <span className={styles.hourlyTime}>{timeOnly}</span>
                            </div>
                            <span className={`${styles.hourlyProfit} ${Number(h.total_profit ?? 0) >= 0 ? styles.win : styles.loss}`}>
                              <span aria-hidden>{Number(h.total_profit ?? 0) >= 0 ? "+" : "−"}</span>{`$${Math.abs(Number(h.total_profit ?? 0)).toFixed(2)}`}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                );
              })()}
            </>
          )}
        </Panel>

        {/* 3-col stats */}
        <div className={styles.sectionGrid}>
          <Panel id="casino" title="Casino Games" collapsed={collapsed} onToggle={toggle} headerAction={<button type="button" className={styles.refreshTopBtn} onClick={(e) => { e.stopPropagation(); fetchDashboard(timeframe); }}>Refresh</button>}>
            {gaming && Number(gaming.total_rounds ?? 0) > 0 ? (
              <div className={styles.statRows}>
                <div className={styles.statRow}><span className={styles.statRowLabel}>Wagered</span><span className={styles.statRowValue}>{fmtMoney(gaming.total_wagered)}</span></div>
                <div className={styles.statRow}><span className={styles.statRowLabel}>Payout</span><span className={styles.statRowValue}>{fmtMoney(gaming.total_payout)}</span></div>
                <div className={styles.statRow}><span className={styles.statRowLabel}>Net Profit</span><span className={styles.statRowValue}><MoneyWithIcon value={gaming.net_profit} /></span></div>
                <div className={styles.statRow}><span className={styles.statRowLabel}>Win rate</span><span className={styles.statRowValue}>{gaming.win_rate ?? 0}%</span></div>
                <div className={styles.statRow}><span className={styles.statRowLabel}>Biggest win</span><span className={styles.statRowValue} style={{ color: "var(--accent-green)" }}><MoneyWithIcon value={gaming.biggest_win} /></span></div>
                <div className={styles.statRow}><span className={styles.statRowLabel}>Biggest loss</span><span className={styles.statRowValue} style={{ color: "var(--accent-red)" }}><MoneyWithIcon value={Number(gaming.biggest_loss ?? 0) * -1} /></span></div>
              </div>
            ) : (
              <EmptyState icon={IconDice} title="No casino rounds yet" text="Play any game — every round is saved to your account and appears here." actionLabel="Browse Games" onAction={() => navigate("/games")} />
            )}
          </Panel>

          <Panel id="custom" title="Custom Bets" collapsed={collapsed} onToggle={toggle} headerAction={<button type="button" className={styles.refreshTopBtn} onClick={(e) => { e.stopPropagation(); fetchDashboard(timeframe); }}>Refresh</button>}>
            {customBets && Number(customBets.total_markets ?? customBets.total ?? 0) > 0 ? (
              <div className={styles.statRows}>
                <div className={styles.statRow}><span className={styles.statRowLabel}>Created</span><span className={styles.statRowValue}>{customBets.total_markets ?? customBets.total ?? 0}</span></div>
                <div className={styles.statRow}><span className={styles.statRowLabel}>Total volume</span><span className={styles.statRowValue}>{fmtMoney(customBets.total_volume ?? customBets.total_pool ?? 0)}</span></div>
                <div className={styles.statRow}><span className={styles.statRowLabel}>Active markets</span><span className={styles.statRowValue}>{customBets.active_markets ?? customBets.open ?? 0}</span></div>
                <div className={styles.statRow}><span className={styles.statRowLabel}>Participations</span><span className={styles.statRowValue}>{customBets.total_bets ?? customBets.participated ?? 0}</span></div>
                <div className={styles.statRow}><span className={styles.statRowLabel}>Profit</span><span className={styles.statRowValue}><MoneyWithIcon value={customBets.net_profit ?? customBets.profit ?? 0} /></span></div>
              </div>
            ) : (
              <EmptyState icon={IconLayers} title="No custom markets" text="Create a market or back an option to see stats." actionLabel="Create Market" onAction={() => navigate("/custom-bets")} />
            )}
          </Panel>
        </div>

        {/* Performance by Game — extended pie background, bigger, readonly tooltip */}
        <Panel id="perf" title="Performance by Game" collapsed={collapsed} onToggle={toggle} headerAction={<button type="button" className={styles.refreshTopBtn} onClick={(e) => { e.stopPropagation(); fetchDashboard(timeframe); }}>Refresh</button>}>
          {breakdown.length === 0 ? (
            <EmptyState icon={IconDice} title="No per-game data" text="Play a few rounds in different games to unlock your performance breakdown." />
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: pieData.length ? "1.4fr 0.9fr" : "1fr", gap: 18, alignItems: "stretch" }}>
              <div style={{ display: "flex", flexDirection: "column" }}>
                {breakdown.slice(0, visiblePerf).map((row) => {
                  const profit = Number(row.profit ?? row.net ?? 0);
                  const wagered = Number(row.wagered ?? row.total_wagered ?? 0);
                  const rounds = Number(row.rounds ?? row.total_rounds ?? 0);
                  const avg = rounds ? wagered / rounds : 0;
                  const key = row.name ?? row.game_name ?? row.display_name;
                  return (
                    <div key={key} className={styles.gameRow}>
                      <img className={styles.gameThumb} src={getGamePoster(row.name ?? row.game_name)} alt={row.display_name ?? row.name} loading="lazy" onError={(e) => { e.currentTarget.src = fallbackPoster; }} />
                      <div className={styles.gameRowMain}>
                        <div className={styles.gameRowName}>{row.display_name ?? row.name}</div>
                        <div className={styles.gameRowSub}>{rounds} rounds • {fmtMoney(wagered)} wagered</div>
                      </div>
                      <div className={styles.gameRowStats}>
                        <div className={styles.gameStat}><div className={styles.gameStatLabel}>Avg Bet</div><div className={styles.gameStatValue}>{fmtMoney(avg)}</div></div>
                        <div className={styles.gameStat}><div className={styles.gameStatLabel}>Profit</div><div className={`${styles.gameStatValue} ${profit > 0 ? styles.profitPos : profit < 0 ? styles.profitNeg : ""}`}><MoneyWithIcon value={profit} /></div></div>
                      </div>
                    </div>
                  );
                })}
                {breakdown.length > visiblePerf && (
                  <button type="button" className={styles.loadMoreBtn} onClick={() => setVisiblePerf(v => v + 8)}>Load more games</button>
                )}
              </div>
              {pieData.length > 0 && (
                <div className={styles.chartWrapPie}>
                  <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: 0.2, textTransform: "uppercase", color: "var(--color-text-secondary)" }}>Wagered share</div>
                  <ResponsiveContainer width="100%" height={280}>
                    <PieChart>
                      <Pie data={pieData} innerRadius={78} outerRadius={112} paddingAngle={3} dataKey="value" isAnimationActive={false}>
                        {pieData.map((entry, idx) => (
                          <Cell key={`c-${idx}`} fill={PIE_COLORS[idx % PIE_COLORS.length]} stroke="rgba(0,0,0,0.2)" strokeWidth={0} />
                        ))}
                      </Pie>
                      <Tooltip content={<PieTooltip />} isAnimationActive={false} animationDuration={0} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
                    {pieData.map((d, i) => (
                      <span key={d.name} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 17, fontWeight: 600, color: "var(--color-text-secondary)" }}>
                        <span style={{ width: 10, height: 10, borderRadius: 2, background: PIE_COLORS[i % PIE_COLORS.length] }} />{d.name}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </Panel>

        <div className={styles.activityGrid}>
          <Panel id="wins" title="Biggest Wins" collapsed={collapsed} onToggle={toggle} headerAction={<button type="button" className={styles.refreshTopBtn} onClick={(e) => { e.stopPropagation(); fetchDashboard(timeframe); }}>Refresh</button>}>
            {biggestWins.length === 0 ? (
              <EmptyState icon={IconTrophy} title="No wins yet" text="Your best payouts will appear here across all time — win a round to populate this board." />
            ) : (
              <>
                <div className={styles.activityList}>
                  {biggestWins.slice(0, visibleWins).map((w) => (
                    <div key={w.id} className={styles.activityItem}>
                      <div className={styles.activityBadge} style={{ background: "rgba(0,231,1,0.12)", color: "var(--accent-green)" }}>
                        {Number(w.multiplier ?? 0).toFixed(1)}x
                      </div>
                      <div className={styles.activityMeta}>
                        <div className={styles.activityTitle}>{w.game_name ?? "Win"} • Bet {fmtMoney(w.bet_amount)}</div>
                        <div className={styles.activitySub}>{fmtDate(w.created_at)}</div>
                      </div>
                      <div className={`${styles.activityValue} ${styles.win}`} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span aria-hidden>+</span>{fmtMoney(Number(w.payout_amount) - Number(w.bet_amount))}</div>
                    </div>
                  ))}
                </div>
                {biggestWins.length > visibleWins && (
                  <button type="button" className={styles.loadMoreBtn} onClick={() => setVisibleWins(v => v + 5)}>Load more</button>
                )}
              </>
            )}
          </Panel>

          <Panel id="breakdown" title="Top Breakdown" collapsed={collapsed} onToggle={toggle} headerAction={<button type="button" className={styles.refreshTopBtn} onClick={(e) => { e.stopPropagation(); fetchDashboard(timeframe); }}>Refresh</button>}>
            {pieData.length === 0 ? (
              <EmptyState icon={IconChart} title="No distribution yet" text="Your wagered split across games appears here." />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {breakdown.slice(0, 4).map((r, i) => (
                  <div key={r.name ?? r.game_name} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                    <span style={{ width: 10, height: 10, borderRadius: 2, background: PIE_COLORS[i % PIE_COLORS.length], flex: "0 0 auto" }} />
                    <span style={{ flex: 1, fontSize: 17, fontWeight: 700, color: "#ffffff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.display_name ?? r.name}</span>
                    <span style={{ fontSize: 17, fontWeight: 800, color: "var(--color-text-secondary)", fontVariantNumeric: "tabular-nums" }}>{fmtMoney(r.wagered ?? r.total_wagered ?? 0)}</span>
                  </div>
                ))}
                <div style={{ fontSize: 17, fontWeight: 600, color: "var(--color-text-secondary)", lineHeight: 1.4 }}>
                  Wagered distribution across your most played games. The pie uses only site tokens — no extra hues.
                </div>
              </div>
            )}
          </Panel>
        </div>

        <Panel id="recent" title="Recent Activity — Your Bets" collapsed={collapsed} onToggle={toggle} headerAction={<button type="button" className={styles.refreshTopBtn} onClick={(e) => { e.stopPropagation(); fetchDashboard(timeframe); }}>Refresh</button>}>
          {recentRounds.length === 0 && recentCustom.length === 0 ? (
            <EmptyState icon={IconActivity} title="No activity yet" text="Every casino round, stock bet and custom wager you place is persisted and shows up here." actionLabel="Browse Games" onAction={() => navigate("/games")} secondary />
          ) : (
            <>
              {recentRounds.length > 0 && (
                <>
                  <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: 0.2, textTransform: "uppercase", color: "var(--color-text-secondary)", marginBottom: 12 }}>Casino rounds</div>
                  <div className={styles.activityList} style={{ marginBottom: recentCustom.length ? 16 : 0 }}>
                    {recentRounds.slice(0, visibleRecent).map((r) => {
                      const profit = Number(r.payout_amount) - Number(r.bet_amount);
                      return (
                        <div key={`r-${r.id}`} className={styles.activityItem}>
                          <img src={getGamePoster(r.game_name ?? r.name)} alt="" className={styles.gameThumb} style={{ width: 40, height: 40, borderRadius: 8 }} onError={(e) => { e.currentTarget.src = fallbackPoster }} />
                          <div className={styles.activityMeta}>
                            <div className={styles.activityTitle}>{r.game_display_name ?? r.game_name} • {Number(r.multiplier ?? 0).toFixed(2)}x</div>
                            <div className={styles.activitySub}>{fmtDate(r.created_at)} • Bet {fmtMoney(r.bet_amount)} → {fmtMoney(r.payout_amount)}</div>
                          </div>
                          <div className={`${styles.activityValue} ${profit >= 0 ? styles.win : styles.loss}`} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}><span aria-hidden>{profit >= 0 ? "+" : "−"}</span>{`$${Math.abs(Number(profit)).toFixed(2)}`}</div>
                        </div>
                      );
                    })}
                  </div>
                  {recentRounds.length > visibleRecent && (
                    <button type="button" className={styles.loadMoreBtn} onClick={() => setVisibleRecent(v => v + 6)}>Load more</button>
                  )}
                </>
              )}

              {recentCustom.length > 0 && (
                <>
                  <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: 0.2, textTransform: "uppercase", color: "var(--color-text-secondary)", marginBottom: 12, marginTop: 4 }}>Custom bets</div>
                  <div className={styles.activityList}>
                    {recentCustom.slice(0, 4).map((c) => (
                      <div key={`c-${c.id ?? c.bet_id}`} className={styles.activityItem}>
                        <div className={styles.activityBadge} style={{ background: "rgba(255,255,255,0.06)", color: "#ffffff" }}>
                          CB
                        </div>
                        <div className={styles.activityMeta}>
                          <div className={styles.activityTitle}>{c.title ?? c.market_title ?? "Custom market"}</div>
                          <div className={styles.activitySub}>{fmtDate(c.created_at)} • {fmtMoney(c.amount ?? c.bet_amount ?? 0)} • {c.status ?? "pending"}</div>
                        </div>
                        <div className={styles.activityValue}>{fmtMoney(c.payout_amount ?? c.amount ?? 0)}</div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}

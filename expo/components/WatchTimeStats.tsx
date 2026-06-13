import { useState, useMemo, useCallback } from "react";
import {
  ActivityIndicator,
  LayoutChangeEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Svg, { Rect, Circle, Line, Text as SvgText, G, Path } from "react-native-svg";

import {
  BarChart3,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  TrendingUp,
  Calendar,
  PieChart,
} from "lucide-react-native";
import { Colors } from "@/constants/colors";
import { getAgentColor } from "@/lib/hooks";
import {
  useWatchTimeStats,
  formatDuration,
  type TimePeriod,
  type DailyBucket,
  type AgentBucket,
  type ChannelBucket,
  type WeeklyComparison,
} from "@/lib/useWatchTimeStats";

type ChartMode = "bar" | "area";

const chartWatched = Colors.success; // green
const chartUnwatched = Colors.warning; // orange

const PERIOD_OPTIONS: { label: string; value: TimePeriod }[] = [
  { label: "7 days", value: "7d" },
  { label: "30 days", value: "30d" },
  { label: "All time", value: "all" },
];

export default function WatchTimeStats() {
  const [open, setOpen] = useState(false);
  const [period, setPeriod] = useState<TimePeriod>("7d");
  const [chartMode, setChartMode] = useState<ChartMode>("bar");
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set());

  const stats = useWatchTimeStats(period);

  const toggleAgent = useCallback((agentId: string) => {
    setExpandedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(agentId)) next.delete(agentId);
      else next.add(agentId);
      return next;
    });
  }, []);

  const data = stats.data;
  const isLoading = stats.isLoading;

  // Build a stable agentId → color map using the same alphabetical
  // sort order the Dashboard's "My Feeds" section uses, so every
  // agent gets the same accent everywhere (feed card, donut, legend,
  // breakdown border).
  const agentColorMap = useMemo(() => {
    if (!data?.byAgent) return new Map<string, string>();
    const sorted = [...data.byAgent].sort((a, b) =>
      a.agentName.localeCompare(b.agentName, undefined, { sensitivity: "base" }),
    );
    const map = new Map<string, string>();
    sorted.forEach((a, i) => map.set(a.agentId, getAgentColor(i)));
    return map;
  }, [data?.byAgent]);

  return (
    <View>
      {/* ── Collapsible header ──────────────────────────────── */}
      <Pressable style={styles.header} onPress={() => setOpen((v) => !v)}>
        <View style={styles.headerLeft}>
          <BarChart3 size={16} color={Colors.accent} />
          <Text style={styles.headerTitle}>Watch Time Statistics</Text>
        </View>
        {open ? (
          <ChevronDown size={18} color={Colors.textSecondary} />
        ) : (
          <ChevronRight size={18} color={Colors.textSecondary} />
        )}
      </Pressable>

      {!open ? null : isLoading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator color={Colors.accent} />
        </View>
      ) : !data || data.totalCount === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>
            Detailed watch-time analytics will appear here as data accumulates.
          </Text>
        </View>
      ) : (
        <View style={styles.body}>
          {/* ── Period selector ──────────────────────────────── */}
          <View style={styles.periodRow}>
            {PERIOD_OPTIONS.map((opt) => {
              const active = opt.value === period;
              return (
                <Pressable
                  key={opt.value}
                  style={[styles.periodChip, active && styles.periodChipActive]}
                  onPress={() => setPeriod(opt.value)}
                >
                  <Text
                    style={[
                      styles.periodChipText,
                      active && styles.periodChipTextActive,
                    ]}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* ── Total Content card ───────────────────────────── */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Total Content</Text>
            <Text style={styles.totalCountLabel}>
              {data.totalWatchedCount} of {data.totalCount} videos
            </Text>
            <Text style={styles.totalDuration}>
              {formatDuration(data.totalWatchedSeconds + data.totalUnwatchedSeconds)}
            </Text>
            {/* Progress bar */}
            <View style={styles.progressBarBg}>
              <View
                style={[
                  styles.progressBarFill,
                  {
                    width: `${data.totalCount > 0 ? Math.round((data.totalWatchedCount / data.totalCount) * 100) : 0}%` as unknown as number,
                  },
                ]}
              />
            </View>
            <View style={styles.statRow}>
              <View style={styles.statItem}>
                <Eye size={14} color={Colors.success} />
                <Text style={styles.statLabel}>Watched</Text>
                <Text style={[styles.statValue, { color: Colors.success }]}>
                  {formatDuration(data.totalWatchedSeconds)} ({data.totalWatchedCount} videos)
                </Text>
              </View>
            </View>
            <View style={styles.statRow}>
              <View style={styles.statItem}>
                <EyeOff size={14} color={Colors.textMuted} />
                <Text style={styles.statLabel}>Not Watched</Text>
                <Text style={[styles.statValue, { color: Colors.textMuted }]}>
                  {formatDuration(data.totalUnwatchedSeconds)} ({data.totalCount - data.totalWatchedCount} videos)
                </Text>
              </View>
            </View>
          </View>

          {/* ── Weekly Comparison card ───────────────────────── */}
          <WeeklyCard wc={data.weeklyComparison} />

          {/* ── Daily Trend chart ────────────────────────────── */}
          <View style={styles.card}>
            <View style={styles.chartHeader}>
              <View style={styles.chartTitleRow}>
                <TrendingUp size={16} color={Colors.accent} />
                <Text style={styles.cardTitle}>Daily Trend</Text>
              </View>
              <View style={styles.chartToggleRow}>
                <Pressable
                  style={[styles.chartToggle, chartMode === "bar" && styles.chartToggleActive]}
                  onPress={() => setChartMode("bar")}
                >
                  <Text style={[styles.chartToggleText, chartMode === "bar" && styles.chartToggleTextActive]}>
                    Bar
                  </Text>
                </Pressable>
                <Pressable
                  style={[styles.chartToggle, chartMode === "area" && styles.chartToggleActive]}
                  onPress={() => setChartMode("area")}
                >
                  <Text style={[styles.chartToggleText, chartMode === "area" && styles.chartToggleTextActive]}>
                    Area
                  </Text>
                </Pressable>
              </View>
            </View>
            {/* Legend */}
            <View style={styles.legendRow}>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: chartWatched }]} />
                <Text style={styles.legendText}>Watched</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendDot, { backgroundColor: chartUnwatched }]} />
                <Text style={styles.legendText}>Not Watched</Text>
              </View>
            </View>
            {data.dailyTrend.length > 0 ? (
              chartMode === "bar" ? (
                <DailyBarChart data={data.dailyTrend} />
              ) : (
                <DailyAreaChart data={data.dailyTrend} />
              )
            ) : (
              <Text style={styles.noDataText}>No daily data for this period.</Text>
            )}
          </View>

          {/* ── By Agent donut ────────────────────────────────── */}
          {data.byAgent.length > 0 && (
            <View style={styles.card}>
              <View style={styles.chartTitleRow}>
                <PieChart size={16} color={Colors.accent} />
                <Text style={styles.cardTitle}>By Agent</Text>
              </View>
              <AgentDonut agents={data.byAgent} colorMap={agentColorMap} />
            </View>
          )}

          {/* ── Detailed Breakdown ────────────────────────────── */}
          {data.byAgent.length > 0 && (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Detailed Breakdown</Text>
              {[...data.byAgent]
                .sort((a, b) =>
                  a.agentName.localeCompare(b.agentName, undefined, { sensitivity: "base" }),
                )
                .map((agent) => (
                  <AgentBreakdownRow
                    key={agent.agentId}
                    agent={agent}
                    color={agentColorMap.get(agent.agentId) ?? Colors.textMuted}
                    expanded={expandedAgents.has(agent.agentId)}
                    onToggle={() => toggleAgent(agent.agentId)}
                  />
                ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

// ── Weekly Comparison Card ──────────────────────────────────────────

function WeeklyCard({ wc }: { wc: WeeklyComparison }) {
  const { thisWeek, lastWeek, watchedTimeDiff } = wc;

  const thisPct = thisWeek.totalCount > 0
    ? Math.round((thisWeek.watchedCount / thisWeek.totalCount) * 100)
    : 0;
  const lastPct = lastWeek.totalCount > 0
    ? Math.round((lastWeek.watchedCount / lastWeek.totalCount) * 100)
    : 0;

  const diffIsPositive = watchedTimeDiff >= 0;

  return (
    <View style={styles.card}>
      <View style={styles.chartTitleRow}>
        <Calendar size={16} color={Colors.accent} />
        <Text style={styles.cardTitle}>Weekly Comparison</Text>
      </View>
      <View style={styles.weeklyColumns}>
        {/* This Week */}
        <View style={styles.weeklyCol}>
          <Text style={styles.weeklyColLabel}>This Week</Text>
          <Text style={[styles.weeklyColValue, { color: Colors.success }]}>
            {formatDuration(thisWeek.watchedSeconds)}
          </Text>
          <Text style={styles.weeklyColSub}>
            {thisWeek.watchedCount} of {thisWeek.totalCount} videos watched
          </Text>
          <View style={styles.progressBarBg}>
            <View
              style={[
                styles.progressBarFill,
                { width: `${thisPct}%` as unknown as number },
              ]}
            />
          </View>
        </View>
        {/* Last Week */}
        <View style={styles.weeklyCol}>
          <Text style={styles.weeklyColLabel}>Last Week</Text>
          <Text style={[styles.weeklyColValue, { color: Colors.textMuted }]}>
            {formatDuration(lastWeek.watchedSeconds)}
          </Text>
          <Text style={styles.weeklyColSub}>
            {lastWeek.watchedCount} of {lastWeek.totalCount} videos watched
          </Text>
          <View style={styles.progressBarBg}>
            <View
              style={[
                styles.progressBarFill,
                { width: `${lastPct}%` as unknown as number, backgroundColor: Colors.textMuted },
              ]}
            />
          </View>
        </View>
      </View>
      {watchedTimeDiff !== 0 ? (
        <View style={styles.diffRow}>
          <Text
            style={[
              styles.diffText,
              { color: diffIsPositive ? Colors.success : Colors.destructive },
            ]}
          >
            {diffIsPositive ? "↑" : "↓"} {Math.abs(watchedTimeDiff)}%
          </Text>
        </View>
      ) : null}
    </View>
  );
}

// ── Daily Bar Chart (react-native-svg) ─────────────────────────────

const BAR_CHART_HEIGHT = 180;
const BAR_CHART_MARGIN = 32;
const BAR_CHART_GAP = 2;
const BAR_CHART_MIN_BAR_WIDTH = 4;

function DailyBarChart({ data }: { data: DailyBucket[] }) {
  const [containerWidth, setContainerWidth] = useState(0);

  const maxHours = useMemo(() => {
    let max = 0;
    for (const d of data) {
      const total = d.watchedHours + d.unwatchedHours;
      if (total > max) max = total;
    }
    return max > 0 ? max : 1;
  }, [data]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setContainerWidth(e.nativeEvent.layout.width);
  }, []);

  const barWidth = useMemo(() => {
    if (data.length === 0 || containerWidth <= BAR_CHART_MARGIN * 2) return 0;
    const avail = containerWidth - BAR_CHART_MARGIN * 2;
    const w = (avail - (data.length - 1) * BAR_CHART_GAP) / data.length;
    return Math.max(BAR_CHART_MIN_BAR_WIDTH, w);
  }, [data.length, containerWidth]);

  const totalWidth = useMemo(
    () => data.length * (barWidth + BAR_CHART_GAP) - BAR_CHART_GAP + BAR_CHART_MARGIN * 2,
    [data.length, barWidth],
  );

  const labelInterval = Math.max(1, Math.floor(data.length / 5));

  return (
    <View onLayout={onLayout} style={{ width: "100%" }}>
      {containerWidth > 0 && barWidth > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <Svg width={totalWidth} height={BAR_CHART_HEIGHT + 40}>
            {/* Y-axis labels */}
            {[0, 0.25, 0.5, 0.75, 1].map((frac) => {
              const y = BAR_CHART_HEIGHT - frac * BAR_CHART_HEIGHT + 10;
              return (
                <SvgText
                  key={frac}
                  x={8}
                  y={y + 4}
                  fill={Colors.textMuted}
                  fontSize={9}
                >
                  {Math.round(maxHours * frac)}h
                </SvgText>
              );
            })}
            {/* Bars */}
            {data.map((d, i) => {
              const x = BAR_CHART_MARGIN + i * (barWidth + BAR_CHART_GAP);
              const watchedH = d.watchedHours;
              const unwatchedH = d.unwatchedHours;
              const watchedHeight = maxHours > 0 ? (watchedH / maxHours) * BAR_CHART_HEIGHT : 0;
              const unwatchedHeight = maxHours > 0 ? (unwatchedH / maxHours) * BAR_CHART_HEIGHT : 0;
              const totalHeight = watchedHeight + unwatchedHeight;

              return (
                <G key={d.date}>
                  {/* Not Watched (behind, full stack) */}
                  {unwatchedHeight > 0 && (
                    <Rect
                      x={x}
                      y={10 + BAR_CHART_HEIGHT - totalHeight}
                      width={barWidth}
                      height={totalHeight}
                      fill={chartUnwatched}
                      rx={1}
                    />
                  )}
                  {/* Watched (on top, bottom portion) */}
                  {watchedHeight > 0 && (
                    <Rect
                      x={x}
                      y={10 + BAR_CHART_HEIGHT - watchedHeight}
                      width={barWidth}
                      height={watchedHeight}
                      fill={chartWatched}
                      rx={1}
                    />
                  )}
                  {/* Zero-height day: show a faint baseline tick */}
                  {totalHeight === 0 && (
                    <Rect
                      x={x + barWidth / 2 - 1}
                      y={10 + BAR_CHART_HEIGHT - 1}
                      width={2}
                      height={1}
                      fill={Colors.textMuted}
                      rx={0}
                    />
                  )}
                  {/* X-axis label */}
                  {i % labelInterval === 0 ? (
                    <SvgText
                      x={x + barWidth / 2}
                      y={BAR_CHART_HEIGHT + 28}
                      fill={Colors.textMuted}
                      fontSize={9}
                      textAnchor="middle"
                    >
                      {d.dateLabel}
                    </SvgText>
                  ) : null}
                </G>
              );
            })}
          </Svg>
        </ScrollView>
      )}
    </View>
  );
}

// ── Daily Area Chart (react-native-svg) ─────────────────────────────

const AREA_CHART_HEIGHT = 160;
const AREA_CHART_MARGIN = 32;

function DailyAreaChart({ data }: { data: DailyBucket[] }) {
  const [containerWidth, setContainerWidth] = useState(0);

  const maxHours = useMemo(() => {
    let max = 0;
    for (const d of data) {
      const total = d.watchedHours + d.unwatchedHours;
      if (total > max) max = total;
    }
    return max > 0 ? max : 1;
  }, [data]);

  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setContainerWidth(e.nativeEvent.layout.width);
  }, []);

  const labelInterval = Math.max(1, Math.floor(data.length / 5));

  // Build point arrays once maxHours and containerWidth are known
  const chartData = useMemo(() => {
    if (data.length === 0 || containerWidth <= AREA_CHART_MARGIN * 2) return null;

    const avail = containerWidth - AREA_CHART_MARGIN * 2;
    const step = data.length > 1 ? avail / (data.length - 1) : avail;

    const baselineY = 10 + AREA_CHART_HEIGHT;

    // Points for the total (watched + unwatched) line
    const totalPoints = data.map((d, i) => {
      const x = AREA_CHART_MARGIN + i * step;
      const totalH = d.watchedHours + d.unwatchedHours;
      const y = baselineY - (totalH / maxHours) * AREA_CHART_HEIGHT;
      return { x, y };
    });

    // Points for the watched line only
    const watchedPoints = data.map((d, i) => {
      const x = AREA_CHART_MARGIN + i * step;
      const y = baselineY - (d.watchedHours / maxHours) * AREA_CHART_HEIGHT;
      return { x, y };
    });

    // Build SVG path strings
    const pointsToD = (pts: { x: number; y: number }[]) =>
      pts.map((p, idx) => (idx === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(" ");

    const totalLine = pointsToD(totalPoints);
    const watchedLine = pointsToD(watchedPoints);

    // Stacked areas: total area (behind, orange), watched area (on top, green)
    const firstX = AREA_CHART_MARGIN;
    const lastX = AREA_CHART_MARGIN + (data.length - 1) * step;

    const totalAreaPath = `${totalLine} L ${lastX} ${baselineY} L ${firstX} ${baselineY} Z`;
    const watchedAreaPath = `${watchedLine} L ${lastX} ${baselineY} L ${firstX} ${baselineY} Z`;

    return {
      totalLine,
      watchedLine,
      totalAreaPath,
      watchedAreaPath,
      totalPoints,
      watchedPoints,
      step,
    };
  }, [data, maxHours, containerWidth]);

  return (
    <View onLayout={onLayout} style={{ width: "100%" }}>
      {containerWidth > 0 && chartData && (
        <Svg width={containerWidth} height={AREA_CHART_HEIGHT + 40}>
          {/* Y-axis labels */}
          {[0, 0.5, 1].map((frac) => {
            const y = AREA_CHART_HEIGHT - frac * AREA_CHART_HEIGHT + 10;
            return (
              <SvgText
                key={frac}
                x={8}
                y={y + 4}
                fill={Colors.textMuted}
                fontSize={9}
              >
                {Math.round(maxHours * frac)}h
              </SvgText>
            );
          })}
          {/* Total area (orange, behind) */}
          <Path d={chartData.totalAreaPath} fill={chartUnwatched} fillOpacity={0.4} />
          {/* Watched area (green, on top) */}
          <Path d={chartData.watchedAreaPath} fill={chartWatched} fillOpacity={0.5} />
          {/* Total line (orange, top edge) */}
          <Path
            d={chartData.totalLine}
            stroke={chartUnwatched}
            strokeWidth={2}
            strokeLinejoin="round"
            fill="none"
          />
          {/* Watched line (green) */}
          <Path
            d={chartData.watchedLine}
            stroke={chartWatched}
            strokeWidth={2}
            strokeLinejoin="round"
            fill="none"
          />
          {/* X-axis labels */}
          {data.map((d, i) =>
            i % labelInterval === 0 ? (
              <SvgText
                key={d.date}
                x={AREA_CHART_MARGIN + (data.length > 1 ? i * chartData.step : chartData.step / 2)}
                y={AREA_CHART_HEIGHT + 28}
                fill={Colors.textMuted}
                fontSize={9}
                textAnchor="middle"
              >
                {d.dateLabel}
              </SvgText>
            ) : null,
          )}
        </Svg>
      )}
    </View>
  );
}

// ── Agent Donut Chart ───────────────────────────────────────────────

const DONUT_SIZE = 200;
const DONUT_RADIUS = 80;
const DONUT_INNER = 50;

function AgentDonut({ agents, colorMap }: { agents: AgentBucket[]; colorMap: Map<string, string> }) {
  const total = useMemo(() => {
    let sum = 0;
    for (const a of agents) sum += a.watchedSeconds + a.unwatchedSeconds;
    return sum;
  }, [agents]);

  if (total === 0) return null;

  const arcs = useMemo(() => {
    const result: { agent: AgentBucket; color: string; startAngle: number; endAngle: number; path: string }[] = [];
    let currentAngle = -Math.PI / 2; // start from top

    for (let i = 0; i < agents.length; i++) {
      const a = agents[i];
      const slice = (a.watchedSeconds + a.unwatchedSeconds) / total;
      const angle = slice * 2 * Math.PI;
      const endAngle = currentAngle + angle;
      const color = colorMap.get(a.agentId) ?? Colors.textMuted;

      const path = describeArc(
        DONUT_SIZE / 2,
        DONUT_SIZE / 2,
        DONUT_RADIUS,
        currentAngle,
        endAngle,
      );

      result.push({ agent: a, color, startAngle: currentAngle, endAngle, path });
      currentAngle = endAngle;
    }

    return result;
  }, [agents, total]);

  return (
    <View style={styles.donutWrap}>
      <Svg width={DONUT_SIZE} height={DONUT_SIZE}>
        {arcs.map((arc, i) => (
          <Path key={i} d={arc.path} fill={arc.color} stroke="none" />
        ))}
        {/* Inner circle for donut effect */}
        <Circle
          cx={DONUT_SIZE / 2}
          cy={DONUT_SIZE / 2}
          r={DONUT_INNER}
          fill={Colors.card}
        />
      </Svg>
      <View style={styles.donutLegend}>
        {agents.map((a) => (
          <View key={a.agentId} style={styles.donutLegendItem}>
            <View style={[styles.donutLegendDot, { backgroundColor: colorMap.get(a.agentId) ?? Colors.textMuted }]} />
            <Text style={styles.donutLegendText} numberOfLines={1}>
              {a.agentName}
            </Text>
          </View>
        ))}
      </View>
    </View>
  );
}

/** Create an SVG arc path. */
function describeArc(
  cx: number,
  cy: number,
  radius: number,
  startAngle: number,
  endAngle: number,
): string {
  const x1 = cx + radius * Math.cos(startAngle);
  const y1 = cy + radius * Math.sin(startAngle);
  const x2 = cx + radius * Math.cos(endAngle);
  const y2 = cy + radius * Math.sin(endAngle);
  const largeArcFlag = endAngle - startAngle > Math.PI ? 1 : 0;

  return `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${x2} ${y2} Z`;
}

// ── Agent Breakdown Row ─────────────────────────────────────────────

function AgentBreakdownRow({
  agent,
  color,
  expanded,
  onToggle,
}: {
  agent: AgentBucket;
  color: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const pct = agent.totalCount > 0 ? Math.round((agent.watchedCount / agent.totalCount) * 100) : 0;

  return (
    <View style={[styles.breakdownAgent, { borderLeftColor: color, borderLeftWidth: 3 }]}>
      <Pressable style={styles.breakdownAgentHeader} onPress={onToggle}>
        {expanded ? (
          <ChevronDown size={14} color={Colors.textSecondary} />
        ) : (
          <ChevronRight size={14} color={Colors.textSecondary} />
        )}
        <Text style={styles.breakdownAgentName} numberOfLines={1}>
          {agent.agentName}
        </Text>
        <Text style={styles.breakdownAgentCount}>
          ({agent.watchedCount}/{agent.totalCount})
        </Text>
      </Pressable>
      {/* collapsed stats */}
      <View style={styles.breakdownStats}>
        <View style={styles.breakdownStatItem}>
          <Eye size={11} color={Colors.success} />
          <Text style={[styles.breakdownStatVal, { color: Colors.success }]}>
            {formatDuration(agent.watchedSeconds)}
          </Text>
        </View>
        <View style={styles.breakdownStatItem}>
          <EyeOff size={11} color={Colors.textMuted} />
          <Text style={[styles.breakdownStatVal, { color: Colors.textMuted }]}>
            {formatDuration(agent.unwatchedSeconds)}
          </Text>
        </View>
      </View>
      <View style={styles.progressBarBg}>
        <View
          style={[
            styles.progressBarFill,
            { width: `${pct}%` as unknown as number },
          ]}
        />
      </View>
      {/* expanded channels */}
      {expanded &&
        agent.channels.map((ch) => (
          <ChannelRow key={ch.channelId} channel={ch} />
        ))}
    </View>
  );
}

function ChannelRow({ channel }: { channel: ChannelBucket }) {
  const pct = channel.totalCount > 0
    ? Math.round((channel.watchedCount / channel.totalCount) * 100)
    : 0;

  return (
    <View style={styles.channelRow}>
      <Text style={styles.channelName} numberOfLines={1}>
        {channel.channelName}
      </Text>
      <Text style={styles.channelCount}>
        ({channel.watchedCount}/{channel.totalCount})
      </Text>
      <View style={styles.breakdownStats}>
        <View style={styles.breakdownStatItem}>
          <Eye size={10} color={Colors.success} />
          <Text style={[styles.breakdownStatVal, { color: Colors.success, fontSize: 10 }]}>
            {formatDuration(channel.watchedSeconds)}
          </Text>
        </View>
        <View style={styles.breakdownStatItem}>
          <EyeOff size={10} color={Colors.textMuted} />
          <Text style={[styles.breakdownStatVal, { color: Colors.textMuted, fontSize: 10 }]}>
            {formatDuration(channel.unwatchedSeconds)}
          </Text>
        </View>
      </View>
      <View style={styles.progressBarBg}>
        <View
          style={[
            styles.progressBarFill,
            { width: `${pct}%` as unknown as number },
          ]}
        />
      </View>
    </View>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────



// ── Styles ──────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Header
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 26,
    paddingVertical: 8,
  },
  headerLeft: { flexDirection: "row", alignItems: "center", gap: 8 },
  headerTitle: {
    fontSize: 13,
    fontWeight: "700" as const,
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },

  // Body
  body: {
    backgroundColor: Colors.card,
    borderRadius: 10,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  loadingBox: {
    backgroundColor: Colors.card,
    borderRadius: 10,
    padding: 24,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  emptyBox: {
    backgroundColor: Colors.card,
    borderRadius: 10,
    padding: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  emptyText: {
    fontSize: 13,
    color: Colors.textMuted,
    textAlign: "center",
    paddingVertical: 16,
    fontStyle: "italic",
  },

  // Period selector
  periodRow: { flexDirection: "row", gap: 8, marginBottom: 14 },
  periodChip: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: Colors.input,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  periodChipActive: { backgroundColor: Colors.accent, borderColor: Colors.accent },
  periodChipText: { fontSize: 12, fontWeight: "600" as const, color: Colors.textSecondary },
  periodChipTextActive: { color: Colors.white },

  // Cards
  card: {
    marginBottom: 12,
    paddingBottom: 4,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: "700" as const,
    color: Colors.textPrimary,
    marginBottom: 6,
  },
  totalCountLabel: {
    fontSize: 13,
    color: Colors.textSecondary,
    marginBottom: 2,
  },
  totalDuration: {
    fontSize: 22,
    fontWeight: "800" as const,
    color: Colors.textPrimary,
    marginBottom: 10,
  },

  // Progress bar
  progressBarBg: {
    height: 5,
    borderRadius: 3,
    backgroundColor: "hsl(220, 20%, 18%)",
    overflow: "hidden",
    marginBottom: 8,
  },
  progressBarFill: {
    height: "100%",
    borderRadius: 3,
    backgroundColor: Colors.success,
  },

  // Stats rows
  statRow: { marginTop: 4 },
  statItem: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  statLabel: { fontSize: 12, color: Colors.textSecondary, fontWeight: "600" as const },
  statValue: { fontSize: 12, fontWeight: "600" as const },

  // Chart header
  chartHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 8,
  },
  chartTitleRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  chartToggleRow: { flexDirection: "row", gap: 2 },
  chartToggle: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: Colors.input,
  },
  chartToggleActive: { backgroundColor: Colors.accent },
  chartToggleText: { fontSize: 11, fontWeight: "600" as const, color: Colors.textSecondary },
  chartToggleTextActive: { color: Colors.white },

  // Legend
  legendRow: { flexDirection: "row", gap: 16, marginBottom: 10 },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  legendDot: { width: 10, height: 10, borderRadius: 2 },
  legendText: { fontSize: 11, color: Colors.textSecondary },

  noDataText: {
    fontSize: 12,
    color: Colors.textMuted,
    textAlign: "center",
    paddingVertical: 20,
    fontStyle: "italic",
  },

  // Weekly comparison
  weeklyColumns: { flexDirection: "row", gap: 12 },
  weeklyCol: { flex: 1 },
  weeklyColLabel: {
    fontSize: 11,
    fontWeight: "700" as const,
    color: Colors.textSecondary,
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  weeklyColValue: { fontSize: 16, fontWeight: "800" as const, marginBottom: 2 },
  weeklyColSub: { fontSize: 11, color: Colors.textSecondary, marginBottom: 6 },
  diffRow: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
  diffText: { fontSize: 16, fontWeight: "800" as const },

  // Donut
  donutWrap: { flexDirection: "row", alignItems: "center", gap: 16, flexWrap: "wrap" },
  donutLegend: { flex: 1, gap: 6 },
  donutLegendItem: { flexDirection: "row", alignItems: "center", gap: 6 },
  donutLegendDot: { width: 10, height: 10, borderRadius: 5 },
  donutLegendText: { fontSize: 12, color: Colors.textPrimary, flexShrink: 1 },

  // Breakdown
  breakdownAgent: {
    paddingLeft: 10,
    paddingVertical: 10,
    marginBottom: 6,
    backgroundColor: "hsla(220, 20%, 10%, 0.4)",
    borderRadius: 6,
  },
  breakdownAgentHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 6,
  },
  breakdownAgentName: { fontSize: 13, fontWeight: "700" as const, color: Colors.textPrimary, flexShrink: 1 },
  breakdownAgentCount: { fontSize: 11, color: Colors.textSecondary },
  breakdownStats: { flexDirection: "row", gap: 16, marginBottom: 4 },
  breakdownStatItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  breakdownStatVal: { fontSize: 11, fontWeight: "600" as const },

  // Channel row
  channelRow: {
    marginLeft: 16,
    paddingTop: 8,
    paddingBottom: 4,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
    marginTop: 6,
  },
  channelName: { fontSize: 12, fontWeight: "600" as const, color: Colors.textPrimary },
  channelCount: { fontSize: 10, color: Colors.textSecondary, marginBottom: 4 },
});

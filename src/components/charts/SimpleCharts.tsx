import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, GRID, TOOLTIP } from "@/components/charts/ChartCard";

/** Small wrappers around Recharts so every dashboard chart shares one look. */

type Row = Record<string, string | number>;
const fmtNum = (v: unknown) => Number(v).toLocaleString("en-US");

/** Horizontal bars: best for named categories, the label sits beside each bar. One colour, because the axis names the bars. */
export function HBars({ data, name, value, label, color = "var(--chart-1)", width = 150, format = fmtNum }: { data: Row[]; name: string; value: string; label: string; color?: string; width?: number; format?: (v: unknown) => string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 44, left: 8, bottom: 0 }} barCategoryGap="28%">
        <XAxis type="number" allowDecimals={false} {...AXIS} tickFormatter={format} />
        <YAxis type="category" dataKey={name} width={width} {...AXIS} axisLine={false} />
        <Tooltip {...TOOLTIP} formatter={(v) => format(v)} />
        <Bar dataKey={value} name={label} fill={color} radius={[0, 4, 4, 0]} maxBarSize={22} label={{ position: "right", fill: "var(--foreground)", fontSize: 12, formatter: format }} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Vertical bars, optionally with a colour per bar (pass colors in the same order as the data). */
export function VBars({ data, name, value, label, color = "var(--chart-1)", colors, format = fmtNum }: { data: Row[]; name: string; value: string; label: string; color?: string; colors?: string[]; format?: (v: unknown) => string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 18, right: 12, left: -8, bottom: 0 }} barCategoryGap="30%">
        <CartesianGrid {...GRID} />
        <XAxis dataKey={name} {...AXIS} interval={0} />
        <YAxis allowDecimals={false} {...AXIS} axisLine={false} tickFormatter={format} />
        <Tooltip {...TOOLTIP} formatter={(v) => format(v)} />
        <Bar dataKey={value} name={label} fill={color} radius={[4, 4, 0, 0]} maxBarSize={44} label={{ position: "top", fill: "var(--foreground)", fontSize: 12, formatter: format }} isAnimationActive={false}>
          {colors && data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Stacked bars. Each segment has a 2px gap in the card colour so neighbours never touch. */
export function Stacked({ data, name, series, horizontal = false, width = 110, format = fmtNum }: { data: Row[]; name: string; series: { key: string; color: string }[]; horizontal?: boolean; width?: number; format?: (v: unknown) => string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout={horizontal ? "vertical" : "horizontal"} margin={{ top: 8, right: 16, left: horizontal ? 8 : -8, bottom: 0 }} barCategoryGap="30%">
        {!horizontal && <CartesianGrid {...GRID} />}
        {horizontal ? <XAxis type="number" {...AXIS} tickFormatter={format} /> : <XAxis dataKey={name} {...AXIS} />}
        {horizontal ? <YAxis type="category" dataKey={name} width={width} {...AXIS} axisLine={false} /> : <YAxis {...AXIS} axisLine={false} tickFormatter={format} />}
        <Tooltip {...TOOLTIP} formatter={(v) => format(v)} />
        {series.map((s) => <Bar key={s.key} dataKey={s.key} stackId="s" fill={s.color} stroke="var(--card)" strokeWidth={2} maxBarSize={horizontal ? 22 : 44} isAnimationActive={false} />)}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function Lines({ data, name, series, format = fmtNum }: { data: Row[]; name: string; series: { key: string; color: string }[]; format?: (v: unknown) => string }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 16, left: -8, bottom: 0 }}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey={name} {...AXIS} />
        <YAxis allowDecimals={false} {...AXIS} axisLine={false} tickFormatter={format} />
        <Tooltip {...TOOLTIP} cursor={{ stroke: "var(--border)" }} formatter={(v) => format(v)} />
        {series.map((s) => (
          <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} strokeWidth={2} dot={{ r: 3, fill: s.color, strokeWidth: 0 }} activeDot={{ r: 5, stroke: "var(--card)", strokeWidth: 2 }} isAnimationActive={false} />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

/** A ring for a split into two or three parts, with the total in the middle. */
export function Ring({ data, total, caption }: { data: { name: string; value: number; color: string }[]; total: string; caption: string }) {
  return (
    <div className="relative h-full">
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Tooltip {...TOOLTIP} formatter={(v) => fmtNum(v)} />
          <Pie data={data} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="88%" paddingAngle={2} stroke="var(--card)" strokeWidth={2} isAnimationActive={false}>
            {data.map((d) => <Cell key={d.name} fill={d.color} />)}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-semibold tabular-nums">{total}</span>
        <span className="text-xs text-muted-foreground">{caption}</span>
      </div>
    </div>
  );
}

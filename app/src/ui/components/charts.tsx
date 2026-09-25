"use client";

import {
	Area,
	Bar,
	CartesianGrid,
	Cell,
	Legend,
	Line,
	Pie,
	AreaChart as RechartsAreaChart,
	BarChart as RechartsBarChart,
	LineChart as RechartsLineChart,
	PieChart as RechartsPieChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";

// Default chart palette — 派生自设计系统变量。
// 图表的多维配色以系统蓝为主，辅以语义色与 AI 主题色，保证与整体主题一致。
const DEFAULT_COLORS = [
	"var(--color-system-blue)",
	"var(--color-success)",
	"var(--color-warning)",
	"var(--color-danger)",
	"var(--color-brand-warm)",
	"var(--color-brand-accent)",
	"var(--color-text-secondary)",
	"var(--color-text-tertiary)",
];

// Axis / grid tokens
const CHART_GRID_STROKE = "var(--color-separator)";
const CHART_AXIS_STROKE = "var(--color-border-strong)";
const CHART_AXIS_TICK_FILL = "var(--color-text-tertiary)";
const CHART_LEGEND_COLOR = "var(--color-text-tertiary)";

// Custom Tooltip Component
interface TooltipPayload {
	color: string;
	name: string;
	value: number;
}

interface CustomTooltipProps {
	active?: boolean;
	payload?: TooltipPayload[];
	label?: string;
}

const CustomTooltip = ({ active, payload, label }: CustomTooltipProps) => {
	if (active && payload && payload.length) {
		return (
			<div
				style={{
					background: "var(--color-panel-elevated)",
					border: "1px solid var(--color-separator)",
					borderRadius: "var(--radius-md)",
					padding: "var(--space-6)",
					boxShadow: "var(--shadow-dropdown)",
					backdropFilter: "var(--backdrop-blur)",
				}}
			>
				{label && (
					<p
						style={{
							color: "var(--color-text-primary)",
							fontWeight: 500,
							marginBottom: "var(--space-4)",
						}}
					>
						{label}
					</p>
				)}
				{payload.map((entry, index) => (
					<div
						key={`${entry.name}-${index}`}
						style={{
							display: "flex",
							alignItems: "center",
							gap: "var(--space-4)",
							fontSize: "var(--font-size-md)",
						}}
					>
						<div
							style={{
								width: 12,
								height: 12,
								borderRadius: "var(--radius-pill)",
								backgroundColor: entry.color,
							}}
						/>
						<span style={{ color: "var(--color-text-tertiary)" }}>
							{entry.name}:
						</span>
						<span style={{ color: "var(--color-text-primary)", fontWeight: 500 }}>
							{entry.value}
						</span>
					</div>
				))}
			</div>
		);
	}
	return null;
};

// Bar Chart Component
export interface BarChartProps {
	data: Record<string, string | number>[];
	xKey: string;
	bars: Array<{ dataKey: string; fill?: string; name?: string }>;
	height?: number;
	showGrid?: boolean;
	showLegend?: boolean;
}

export function BarChart({
	data,
	xKey,
	bars,
	height = 300,
	showGrid = true,
	showLegend = false,
}: BarChartProps) {
	return (
		<ResponsiveContainer width="100%" height={height}>
			<RechartsBarChart data={data}>
				{showGrid && (
					<CartesianGrid
						strokeDasharray="3 3"
						stroke={CHART_GRID_STROKE}
					/>
				)}
				<XAxis
					dataKey={xKey}
					stroke={CHART_AXIS_STROKE}
					tick={{ fill: CHART_AXIS_TICK_FILL, fontSize: 12 }}
				/>
				<YAxis
					stroke={CHART_AXIS_STROKE}
					tick={{ fill: CHART_AXIS_TICK_FILL, fontSize: 12 }}
				/>
				<Tooltip content={<CustomTooltip />} />
				{showLegend && (
					<Legend
						wrapperStyle={{ color: CHART_LEGEND_COLOR }}
						iconType="circle"
					/>
				)}
				{bars.map((bar, index) => (
					<Bar
						key={bar.dataKey}
						dataKey={bar.dataKey}
						fill={bar.fill || DEFAULT_COLORS[index % DEFAULT_COLORS.length]}
						name={bar.name || bar.dataKey}
						radius={[4, 4, 0, 0]}
					/>
				))}
			</RechartsBarChart>
		</ResponsiveContainer>
	);
}

// Line Chart Component
export interface LineChartProps {
	data: Record<string, string | number>[];
	xKey: string;
	lines: Array<{
		dataKey: string;
		stroke?: string;
		name?: string;
		strokeWidth?: number;
	}>;
	height?: number;
	showGrid?: boolean;
	showLegend?: boolean;
}

export function LineChart({
	data,
	xKey,
	lines,
	height = 300,
	showGrid = true,
	showLegend = true,
}: LineChartProps) {
	return (
		<ResponsiveContainer width="100%" height={height}>
			<RechartsLineChart data={data}>
				{showGrid && (
					<CartesianGrid
						strokeDasharray="3 3"
						stroke={CHART_GRID_STROKE}
					/>
				)}
				<XAxis
					dataKey={xKey}
					stroke={CHART_AXIS_STROKE}
					tick={{ fill: CHART_AXIS_TICK_FILL, fontSize: 12 }}
				/>
				<YAxis
					stroke={CHART_AXIS_STROKE}
					tick={{ fill: CHART_AXIS_TICK_FILL, fontSize: 12 }}
				/>
				<Tooltip content={<CustomTooltip />} />
				{showLegend && (
					<Legend
						wrapperStyle={{ color: CHART_LEGEND_COLOR }}
						iconType="circle"
					/>
				)}
				{lines.map((line, index) => (
					<Line
						key={line.dataKey}
						type="monotone"
						dataKey={line.dataKey}
						stroke={
							line.stroke || DEFAULT_COLORS[index % DEFAULT_COLORS.length]
						}
						name={line.name || line.dataKey}
						strokeWidth={line.strokeWidth || 2}
						dot={{
							fill:
								line.stroke || DEFAULT_COLORS[index % DEFAULT_COLORS.length],
							r: 4,
						}}
						activeDot={{ r: 6 }}
					/>
				))}
			</RechartsLineChart>
		</ResponsiveContainer>
	);
}

// Area Chart Component
export interface AreaChartProps {
	data: Record<string, string | number>[];
	xKey: string;
	areas: Array<{
		dataKey: string;
		fill?: string;
		stroke?: string;
		name?: string;
	}>;
	height?: number;
	showGrid?: boolean;
	showLegend?: boolean;
	stacked?: boolean;
}

export function AreaChart({
	data,
	xKey,
	areas,
	height = 300,
	showGrid = true,
	showLegend = true,
	stacked = false,
}: AreaChartProps) {
	return (
		<ResponsiveContainer width="100%" height={height}>
			<RechartsAreaChart data={data}>
				{showGrid && (
					<CartesianGrid
						strokeDasharray="3 3"
						stroke={CHART_GRID_STROKE}
					/>
				)}
				<XAxis
					dataKey={xKey}
					stroke={CHART_AXIS_STROKE}
					tick={{ fill: CHART_AXIS_TICK_FILL, fontSize: 12 }}
				/>
				<YAxis
					stroke={CHART_AXIS_STROKE}
					tick={{ fill: CHART_AXIS_TICK_FILL, fontSize: 12 }}
				/>
				<Tooltip content={<CustomTooltip />} />
				{showLegend && (
					<Legend
						wrapperStyle={{ color: CHART_LEGEND_COLOR }}
						iconType="circle"
					/>
				)}
				{areas.map((area, index) => (
					<Area
						key={area.dataKey}
						type="monotone"
						dataKey={area.dataKey}
						stackId={stacked ? "1" : undefined}
						fill={area.fill || DEFAULT_COLORS[index % DEFAULT_COLORS.length]}
						stroke={
							area.stroke || DEFAULT_COLORS[index % DEFAULT_COLORS.length]
						}
						name={area.name || area.dataKey}
						fillOpacity={0.6}
					/>
				))}
			</RechartsAreaChart>
		</ResponsiveContainer>
	);
}

// Pie Chart Component
interface PieDataItem {
	[key: string]: string | number;
}

export interface PieChartProps {
	data: PieDataItem[];
	nameKey: string;
	valueKey: string;
	height?: number;
	innerRadius?: number;
	outerRadius?: number;
	colors?: string[];
	showLegend?: boolean;
}

export function PieChart({
	data,
	nameKey,
	valueKey,
	height = 300,
	innerRadius = 0,
	outerRadius = 80,
	colors = DEFAULT_COLORS,
	showLegend = true,
}: PieChartProps) {
	return (
		<ResponsiveContainer width="100%" height={height}>
			<RechartsPieChart>
				<Pie
					data={data}
					cx="50%"
					cy="50%"
					innerRadius={innerRadius}
					outerRadius={outerRadius}
					dataKey={valueKey}
					nameKey={nameKey}
					label={(props) => {
						const entry = data[props.index];
						return `${entry[nameKey]}: ${entry[valueKey]}`;
					}}
					labelLine={{ stroke: CHART_AXIS_STROKE }}
				>
					{data.map((item, index) => (
						<Cell
							key={`cell-${item[nameKey]}-${index}`}
							fill={colors[index % colors.length]}
						/>
					))}
				</Pie>
				<Tooltip content={<CustomTooltip />} />
				{showLegend && (
					<Legend
						wrapperStyle={{ color: CHART_LEGEND_COLOR }}
						iconType="circle"
					/>
				)}
			</RechartsPieChart>
		</ResponsiveContainer>
	);
}

// Donut Chart Component (Pie with inner radius)
export interface DonutChartProps extends PieChartProps {}

export function DonutChart({
	data,
	nameKey,
	valueKey,
	height = 300,
	innerRadius = 60,
	outerRadius = 80,
	colors = DEFAULT_COLORS,
	showLegend = true,
}: DonutChartProps) {
	return (
		<PieChart
			data={data}
			nameKey={nameKey}
			valueKey={valueKey}
			height={height}
			innerRadius={innerRadius}
			outerRadius={outerRadius}
			colors={colors}
			showLegend={showLegend}
		/>
	);
}

// Stacked Bar Chart Component
export interface StackedBarChartProps {
	data: Record<string, string | number>[];
	xKey: string;
	stackKeys: Array<{ dataKey: string; fill?: string; name?: string }>;
	height?: number;
	showGrid?: boolean;
	showLegend?: boolean;
}

export function StackedBarChart({
	data,
	xKey,
	stackKeys,
	height = 300,
	showGrid = true,
	showLegend = true,
}: StackedBarChartProps) {
	return (
		<ResponsiveContainer width="100%" height={height}>
			<RechartsBarChart data={data}>
				{showGrid && (
					<CartesianGrid
						strokeDasharray="3 3"
						stroke={CHART_GRID_STROKE}
					/>
				)}
				<XAxis
					dataKey={xKey}
					stroke={CHART_AXIS_STROKE}
					tick={{ fill: CHART_AXIS_TICK_FILL, fontSize: 12 }}
				/>
				<YAxis
					stroke={CHART_AXIS_STROKE}
					tick={{ fill: CHART_AXIS_TICK_FILL, fontSize: 12 }}
				/>
				<Tooltip content={<CustomTooltip />} />
				{showLegend && (
					<Legend
						wrapperStyle={{ color: CHART_LEGEND_COLOR }}
						iconType="circle"
					/>
				)}
				{stackKeys.map((stack, index) => (
					<Bar
						key={stack.dataKey}
						dataKey={stack.dataKey}
						stackId="a"
						fill={stack.fill || DEFAULT_COLORS[index % DEFAULT_COLORS.length]}
						name={stack.name || stack.dataKey}
						radius={index === stackKeys.length - 1 ? [4, 4, 0, 0] : undefined}
					/>
				))}
			</RechartsBarChart>
		</ResponsiveContainer>
	);
}

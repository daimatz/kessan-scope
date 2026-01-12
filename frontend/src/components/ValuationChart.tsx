import { useMemo } from 'react';
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import type { StockValuation } from '../api';

interface ValuationChartProps {
  valuations: StockValuation[];
  currentFiscalYear?: string;
  currentFiscalQuarter?: number | null;
}

interface ChartDataPoint {
  label: string;
  fiscalYear: string;
  fiscalQuarter: number | null;
  marketCap: number | null;
  revenue: number | null;
  operatingIncome: number | null;
  isCurrent: boolean;
}

// 数値を読みやすい形式にフォーマット（億円単位）
function formatValue(value: number | null): string {
  if (value === null || value === undefined) return '-';
  const okuYen = value / 100;  // 百万円 → 億円
  if (Math.abs(okuYen) >= 10000) {
    return `${(okuYen / 10000).toFixed(1)}兆`;
  }
  if (Math.abs(okuYen) >= 1) {
    return `${okuYen.toFixed(0)}億`;
  }
  return `${(value).toFixed(0)}百万`;
}

// ツールチップのカスタムコンテンツ
function CustomTooltip({ active, payload, label }: {
  active?: boolean;
  payload?: Array<{ name: string; value: number | null; color: string }>;
  label?: string;
}) {
  if (!active || !payload) return null;

  return (
    <div className="valuation-tooltip">
      <p className="tooltip-label">{label}</p>
      {payload.map((entry, index) => (
        <p key={index} style={{ color: entry.color }}>
          {entry.name}: {formatValue(entry.value)}
        </p>
      ))}
    </div>
  );
}

export default function ValuationChart({
  valuations,
  currentFiscalYear,
  currentFiscalQuarter,
}: ValuationChartProps) {
  // データを時系列でソートして整形
  const chartData = useMemo(() => {
    const sorted = [...valuations].sort((a, b) => {
      // fiscal_year と fiscal_quarter でソート
      if (a.fiscal_year !== b.fiscal_year) {
        return (a.fiscal_year || '').localeCompare(b.fiscal_year || '');
      }
      return (a.fiscal_quarter || 0) - (b.fiscal_quarter || 0);
    });

    return sorted.map((v): ChartDataPoint => {
      const quarterStr = v.fiscal_quarter ? `Q${v.fiscal_quarter}` : '';
      return {
        label: `${v.fiscal_year}${quarterStr}`,
        fiscalYear: v.fiscal_year || '',
        fiscalQuarter: v.fiscal_quarter,
        marketCap: v.market_cap,
        revenue: v.revenue,
        operatingIncome: v.operating_income,
        isCurrent: v.fiscal_year === currentFiscalYear && v.fiscal_quarter === currentFiscalQuarter,
      };
    });
  }, [valuations, currentFiscalYear, currentFiscalQuarter]);

  if (chartData.length === 0) {
    return (
      <div className="valuation-chart-empty">
        バリュエーションデータがありません
      </div>
    );
  }

  // Y軸の最大値を計算
  const maxRevenue = Math.max(...chartData.map(d => d.revenue || 0));
  const maxMarketCap = Math.max(...chartData.map(d => d.marketCap || 0));

  return (
    <div className="valuation-chart">
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
          <XAxis
            dataKey="label"
            tick={{ fill: '#9ca3af', fontSize: 12 }}
            axisLine={{ stroke: '#4b5563' }}
          />
          <YAxis
            yAxisId="left"
            tick={{ fill: '#9ca3af', fontSize: 12 }}
            axisLine={{ stroke: '#4b5563' }}
            tickFormatter={(value) => formatValue(value)}
            domain={[0, maxRevenue * 1.1]}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fill: '#9ca3af', fontSize: 12 }}
            axisLine={{ stroke: '#4b5563' }}
            tickFormatter={(value) => formatValue(value)}
            domain={[0, maxMarketCap * 1.1]}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ paddingTop: '10px' }}
            formatter={(value) => <span style={{ color: '#e5e7eb' }}>{value}</span>}
          />
          <Bar
            yAxisId="left"
            dataKey="revenue"
            name="売上高"
            fill="#3b82f6"
            opacity={0.8}
          />
          <Bar
            yAxisId="left"
            dataKey="operatingIncome"
            name="営業利益"
            fill="#10b981"
            opacity={0.8}
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="marketCap"
            name="時価総額"
            stroke="#f59e0b"
            strokeWidth={2}
            dot={{ fill: '#f59e0b', r: 4 }}
            activeDot={{ r: 6 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

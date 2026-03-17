'use client';

// Simplified, readable Equity Analytics with compact controls and layout

import { useState, useMemo, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { 
  TrendingUp, 
  Calendar,
  BarChart3,
  LineChart as LineChartIcon,
  AreaChart as AreaChartIcon,
  Eye,
  EyeOff,
} from 'lucide-react';
import { format } from 'date-fns';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { MultiSelect } from '@/components/ui/multi-select';
import { 
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

type ChartType = 'line' | 'area' | 'bar';
type TimePeriod = '7d' | '30d' | '90d' | '365d';

interface EquityDataPoint {
  date: string;
  [accountId: string]: string | number;
}

export function EquityAnalyticsChart() {
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('7d');
  const [chartType, setChartType] = useState<ChartType>('line');

  // Calculate days based on time period
  const getDaysCount = (period: TimePeriod): number => {
    switch (period) {
      case '7d': return 7;
      case '30d': return 30;
      case '90d': return 90;
      case '365d': return 365;
      default: return 7;
    }
  };

  const days = getDaysCount(timePeriod);

  // Fetch account balances
  const { data, isLoading, error } = useQuery({
    queryKey: ['account-balances'],
    queryFn: async () => {
      const response = await fetch('/api/accounts/balances');
      if (!response.ok) throw new Error('Failed to fetch balances');
      return response.json();
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Fetch historical equity data from Alpaca Portfolio History API
  const { data: historyData, isLoading: isLoadingHistory } = useQuery({
    queryKey: ['equity-history', days, selectedAccounts],
    queryFn: async () => {
      const accountIds = selectedAccounts.length > 0 
        ? selectedAccounts.join(',')
        : '';
      const response = await fetch(`/api/accounts/equity-history?days=${days}${accountIds ? `&account_ids=${accountIds}` : ''}`);
      if (!response.ok) throw new Error('Failed to fetch equity history');
      return response.json();
    },
    refetchInterval: 30000, // Refresh every 30 seconds
    enabled: Boolean(selectedAccounts.length > 0 || (data?.data && (data.data.master || data.data.clients?.length > 0))), // Only fetch when we have accounts
  });

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  // Prepare accounts list with growth data
  const allAccounts = useMemo(() => {
    const accounts: Array<{ 
      id: string; 
      name: string; 
      equity: number; 
      type: 'master' | 'client';
      growth?: number;
      growthPercent?: number;
    }> = [];
    
    if (data?.data) {
      if (data.data.master && data.data.master.status === 'success') {
        const growthInfo = historyData?.data?.growth?.['master'];
        accounts.push({
          id: 'master',
          name: `Master (${data.data.master.account_id})`,
          equity: data.data.master.equity || 0,
          type: 'master',
          growth: growthInfo?.growth || 0,
          growthPercent: growthInfo?.growthPercent || 0,
        });
      }
      
      data.data.clients?.forEach((balance: any) => {
        if (balance.status === 'success') {
          const accountKey = `client_${balance.account_id}`;
          const growthInfo = historyData?.data?.growth?.[accountKey];
          accounts.push({
            id: accountKey,
            name: balance.account_name || balance.account_id,
            equity: balance.equity || 0,
            type: 'client',
            growth: growthInfo?.growth || 0,
            growthPercent: growthInfo?.growthPercent || 0,
          });
        }
      });
    }
    
    return accounts;
  }, [data, historyData]);

  // Initialize selected accounts (select all by default)
  useMemo(() => {
    if (selectedAccounts.length === 0 && allAccounts.length > 0) {
      setSelectedAccounts(allAccounts.map(acc => acc.id));
    }
  }, [allAccounts, selectedAccounts.length]);

  // Prepare options for multiselect
  const accountOptions = useMemo(() => {
    return allAccounts.map(account => ({
      value: account.id,
      label: account.name,
    }));
  }, [allAccounts]);

  // Prepare chart data from Alpaca Portfolio History
  const chartData: EquityDataPoint[] = useMemo(() => {
    const histories = historyData?.data?.histories || {};
    const selectedAccountsData = allAccounts.filter(acc => selectedAccounts.includes(acc.id));
    
    if (selectedAccountsData.length === 0) {
      return [];
    }

    // Get all unique timestamps from all histories
    const allTimestamps = new Set<number>();
    selectedAccountsData.forEach(account => {
      const history = histories[account.id];
      if (history) {
        history.forEach((point: any) => {
          allTimestamps.add(point.timestamp);
        });
      }
    });

    // Sort timestamps
    const sortedTimestamps = Array.from(allTimestamps).sort((a, b) => a - b);

    // Create data points
    const dataPoints: EquityDataPoint[] = sortedTimestamps.map((timestamp) => {
      const date = new Date(timestamp * 1000); // Alpaca returns Unix timestamp in seconds
      
      const dataPoint: EquityDataPoint = {
        date: format(date, days <= 30 ? 'MMM dd' : 'MMM dd, yyyy'),
      };

      // Add equity value for each selected account
      selectedAccountsData.forEach((account) => {
        const history = histories[account.id];
        if (history) {
          // Find the closest data point for this timestamp
          const point = history.find((p: any) => p.timestamp === timestamp);
          if (point) {
            dataPoint[account.id] = point.equity;
          } else {
            // If no exact match, use the most recent value before this timestamp
            const beforePoint = history
              .filter((p: any) => p.timestamp <= timestamp)
              .sort((a: any, b: any) => b.timestamp - a.timestamp)[0];
            if (beforePoint) {
              dataPoint[account.id] = beforePoint.equity;
            } else {
              // Fallback to current equity if no historical data
              dataPoint[account.id] = account.equity;
            }
          }
        } else {
          // No history data, use current equity
          dataPoint[account.id] = account.equity;
        }
      });

      return dataPoint;
    });

    // If no historical data, create placeholder data points
    if (dataPoints.length === 0) {
      const now = new Date();
      for (let i = days - 1; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        
        const dataPoint: EquityDataPoint = {
          date: format(date, days <= 30 ? 'MMM dd' : 'MMM dd, yyyy'),
        };
        
        selectedAccountsData.forEach((account) => {
          dataPoint[account.id] = account.equity;
        });
        
        dataPoints.push(dataPoint);
      }
    }

    return dataPoints;
  }, [allAccounts, selectedAccounts, timePeriod, historyData, days]);

  // Color palette for accounts
  const colorPalette = [
    '#3b82f6', // Blue - Master
    '#10b981', // Green
    '#f59e0b', // Amber
    '#ef4444', // Red
    '#8b5cf6', // Purple
    '#ec4899', // Pink
    '#06b6d4', // Cyan
    '#84cc16', // Lime
    '#f97316', // Orange
    '#6366f1', // Indigo
  ];

  const getAccountColor = (accountId: string, index: number) => {
    if (accountId === 'master') return colorPalette[0];
    return colorPalette[(index % (colorPalette.length - 1)) + 1];
  };

  // Get selected accounts for display
  const selectedAccountsData = allAccounts.filter(acc => selectedAccounts.includes(acc.id));
  const [visibleSeries, setVisibleSeries] = useState<string[]>([]);

  // Keep visible series in sync with selection
  useEffect(() => {
    setVisibleSeries(selectedAccounts);
  }, [selectedAccounts]);

  const visibleAccountsData = selectedAccountsData.filter(acc => visibleSeries.includes(acc.id));

  if (isLoading || isLoadingHistory) {
    return (
      <Card className="border shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Equity Analytics
          </CardTitle>
        </CardHeader>
        <CardContent className="py-10">
          <div className="flex flex-col items-center justify-center gap-3">
            <div className="h-6 w-6 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
            <div className="text-center text-muted-foreground">Loading data…</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-destructive" />
            Equity Analytics
          </CardTitle>
        </CardHeader>
        <CardContent className="py-8">
          <div className="text-center text-destructive">Failed to load chart data</div>
        </CardContent>
      </Card>
    );
  }

  // Custom tooltip renderer (shared across chart types)
  const renderTooltip = ({ active, label, payload }: any) => {
    if (!active || !payload || !payload.length) return null;
    const index = chartData.findIndex((d) => d.date === label);
    const valuesById: Record<string, number> = {};
    payload.forEach((p: any) => {
      if (p && typeof p.value !== 'undefined' && p.dataKey) {
        valuesById[p.dataKey] = Number(p.value) || 0;
      }
    });

    const rows = visibleAccountsData
      .map((acc, i) => {
        const value = valuesById[acc.id];
        if (typeof value === 'undefined') return null;
        const prev = index > 0 ? Number((chartData[index - 1] as any)[acc.id] ?? NaN) : NaN;
        const delta = isNaN(prev) ? 0 : value - prev;
        const positive = delta >= 0;
        return {
          id: acc.id,
          name: acc.name,
          color: getAccountColor(acc.id, i),
          value,
          delta,
          positive,
        };
      })
      .filter(Boolean) as Array<{ id: string; name: string; color: string; value: number; delta: number; positive: boolean }>;

    rows.sort((a, b) => b.value - a.value);

    return (
      <div className="rounded-md border bg-card text-card-foreground shadow-sm min-w-[260px]">
        <div className="px-3 py-2 border-b text-xs font-medium text-muted-foreground">
          {label}
        </div>
        <div className="p-2">
          <div className="space-y-1">
            {rows.map((row) => (
              <div key={row.id} className="flex items-center gap-2">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: row.color }}
                />
                <span className="text-xs text-muted-foreground truncate flex-1" title={row.name}>
                  {row.name}
                </span>
                <span className="text-xs font-semibold tabular-nums">
                  {formatCurrency(row.value)}
                </span>
                {!isNaN(row.delta) && (
                  <span className={`text-[10px] tabular-nums ml-1 ${row.positive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                    {row.positive ? '+' : ''}{formatCurrency(Math.abs(row.delta))}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {selectedAccounts.length === 0 ? (
        <Card className="border shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-muted-foreground" />
              Equity Analytics
            </CardTitle>
          </CardHeader>
          <CardContent className="py-14">
            <div className="text-center text-muted-foreground">Select one or more accounts to view analytics.</div>
          </CardContent>
        </Card>
      ) : (
        <Card className="border shadow-sm">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-primary" />
                Equity Analytics
              </span>
              <span className="text-sm text-muted-foreground flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                {timePeriod === '7d' ? 'Last 7 days' : timePeriod === '30d' ? 'Last 30 days' : timePeriod === '90d' ? 'Last 90 days' : 'Last 365 days'}
                <span>•</span>
                {selectedAccounts.length} selected
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 lg:grid-cols-10 items-stretch min-h-[640px]">
              {/* Left: Accounts data (30%) */}
              <div className="lg:col-span-3 pr-1 flex flex-col lg:max-h-[640px] lg:overflow-y-auto">

                {/* Account Summary table */}
                {selectedAccountsData.length > 0 ? (
                  <div className="border rounded-md">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Account</TableHead>
                          <TableHead className="text-right">Equity</TableHead>
                          <TableHead className="text-right">Growth</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {selectedAccountsData.map((account, index) => {
                          const currentEquity = account.equity || 0;
                          const growthPercent = account.growthPercent || 0;
                          const growth = account.growth || 0;
                          const isPositive = growthPercent >= 0;
                          const accountColor = getAccountColor(account.id, index);
                          return (
                            <TableRow key={account.id}>
                              <TableCell>
                                <div className="flex items-center gap-2">
                                  <span
                                    className="inline-block w-2.5 h-2.5 rounded-full"
                                    style={{ backgroundColor: accountColor }}
                                  />
                                  <span className="truncate max-w-[220px]" title={account.name}>{account.name}</span>
                                </div>
                              </TableCell>
                              <TableCell className="text-right font-medium">{formatCurrency(Number(currentEquity))}</TableCell>
                              <TableCell className={`text-right ${isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
                                {isPositive ? '+' : ''}{growthPercent.toFixed(2)}% ({isPositive ? '+' : ''}{formatCurrency(growth)})
                              </TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">No account data</div>
                )}

                {/* Custom Legend with toggle (scrollable) */}
                
              </div>

              {/* Right: Chart (70%) */}
              <div className="lg:col-span-7 flex flex-col h-full overflow-hidden">
                {/* Filters at top of chart */}
                <div className="border rounded-md p-3 mb-4">
                  <div className="grid gap-3">
                    <div>
                      <div className="text-xs text-muted-foreground mb-2">Accounts</div>
                      <MultiSelect
                        options={accountOptions}
                        selected={selectedAccounts}
                        onChange={setSelectedAccounts}
                        placeholder="Select accounts…"
                        className="w-full"
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <div className="text-xs text-muted-foreground mb-2">Time period</div>
                        <Select value={timePeriod} onValueChange={(value) => setTimePeriod(value as TimePeriod)}>
                          <SelectTrigger className="w-full h-10">
                            <div className="flex items-center gap-2">
                              <Calendar className="h-4 w-4 text-muted-foreground" />
                              <SelectValue />
                            </div>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="7d">Last 7 days</SelectItem>
                            <SelectItem value="30d">Last 30 days</SelectItem>
                            <SelectItem value="90d">Last 90 days</SelectItem>
                            <SelectItem value="365d">Last 365 days</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <div className="text-xs text-muted-foreground mb-2">Chart type</div>
                        <Select value={chartType} onValueChange={(value) => setChartType(value as ChartType)}>
                          <SelectTrigger className="w-full h-10">
                            <div className="flex items-center gap-2">
                              {chartType === 'line' && <LineChartIcon className="h-4 w-4 text-muted-foreground" />}
                              {chartType === 'area' && <AreaChartIcon className="h-4 w-4 text-muted-foreground" />}
                              {chartType === 'bar' && <BarChart3 className="h-4 w-4 text-muted-foreground" />}
                              <SelectValue />
                            </div>
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="line">Line</SelectItem>
                            <SelectItem value="area">Area</SelectItem>
                            <SelectItem value="bar">Bar</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="border rounded-md p-2 flex-1 min-h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    {chartType === 'line' && (
                      <LineChart data={chartData} margin={{ top: 10, right: 24, left: 8, bottom: 32 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                        <XAxis 
                          dataKey="date"
                      height={28}
                      tickMargin={8}
                      interval="preserveStartEnd"
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                      stroke="hsl(var(--border))"
                    />
                    <YAxis 
                      width={60}
                      tickMargin={8}
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                      tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                      stroke="hsl(var(--border))"
                    />
                    <Tooltip content={renderTooltip} />
                    {visibleAccountsData.map((account, index) => (
                      <Line
                        key={account.id}
                        type="monotone"
                        dataKey={account.id}
                        stroke={getAccountColor(account.id, index)}
                        strokeWidth={2}
                        dot={false}
                        activeDot={{ r: 4 }}
                        name={account.name}
                      />
                    ))}
                    </LineChart>
                  )}
                  {chartType === 'area' && (
                    <AreaChart data={chartData} margin={{ top: 10, right: 24, left: 8, bottom: 32 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                      <XAxis 
                        dataKey="date"
                        height={28}
                        tickMargin={8}
                        interval="preserveStartEnd"
                        tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                        stroke="hsl(var(--border))"
                      />
                      <YAxis 
                        width={60}
                        tickMargin={8}
                        tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                        tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                        stroke="hsl(var(--border))"
                      />
                    <Tooltip content={renderTooltip} />
                    {visibleAccountsData.map((account, index) => (
                      <Area
                        key={account.id}
                        type="monotone"
                        dataKey={account.id}
                        stroke={getAccountColor(account.id, index)}
                        fill={getAccountColor(account.id, index) + '33'}
                        strokeWidth={2}
                        name={account.name}
                      />
                    ))}
                    </AreaChart>
                  )}
                  {chartType === 'bar' && (
                    <BarChart data={chartData} margin={{ top: 10, right: 24, left: 8, bottom: 32 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.4} />
                      <XAxis 
                        dataKey="date"
                        height={28}
                        tickMargin={8}
                        interval="preserveStartEnd"
                        tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                        stroke="hsl(var(--border))"
                      />
                      <YAxis 
                        width={60}
                        tickMargin={8}
                        tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                        tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                        stroke="hsl(var(--border))"
                      />
                    <Tooltip content={renderTooltip} />
                    {visibleAccountsData.map((account, index) => (
                      <Bar
                        key={account.id}
                        dataKey={account.id}
                        fill={getAccountColor(account.id, index)}
                        radius={[3, 3, 0, 0]}
                        name={account.name}
                      />
                    ))}
                    </BarChart>
                  )}
                  </ResponsiveContainer>
                </div>
                {/* Series toggles below chart */}
                {selectedAccountsData.length > 0 && (
                  <div className="space-y-2 mt-4">
                    <div className="flex items-center justify-between">
                      <div className="text-xs text-muted-foreground">Series</div>
                      <button
                        className="text-xs text-primary hover:underline"
                        onClick={() => setVisibleSeries(selectedAccounts)}
                      >
                        Reset
                      </button>
                    </div>
                    <div className="border rounded-md p-2 max-h-32 overflow-auto">
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2">
                        {selectedAccountsData.map((account, index) => {
                          const color = getAccountColor(account.id, index);
                          const active = visibleSeries.includes(account.id);
                          return (
                            <button
                              key={account.id}
                              type="button"
                              onClick={() =>
                                setVisibleSeries((prev) =>
                                  prev.includes(account.id)
                                    ? prev.filter((id) => id !== account.id)
                                    : [...prev, account.id]
                                )
                              }
                              className={`flex items-center gap-2 rounded border px-2 py-1 text-left text-xs transition-colors ${
                                active
                                  ? 'bg-background hover:bg-accent/40'
                                  : 'bg-muted/40 text-muted-foreground hover:bg-muted'
                              }`}
                              title={account.name}
                              aria-pressed={active}
                            >
                              <span
                                className="inline-block w-2.5 h-2.5 rounded-full flex-shrink-0"
                                style={{ backgroundColor: color, opacity: active ? 1 : 0.3 }}
                              />
                              <span className="truncate flex-1">{account.name}</span>
                              {active ? (
                                <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                              ) : (
                                <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

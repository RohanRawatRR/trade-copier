'use client';

// Advanced Equity Analytics Chart with filters, search, and chart types

import { useState, useMemo } from 'react';
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
  AreaChart as AreaChartIcon
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
    enabled: selectedAccounts.length > 0 || (data?.data && (data.data.master || data.data.clients?.length > 0)), // Only fetch when we have accounts
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

  if (isLoading || isLoadingHistory) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Equity Analytics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground py-8">Loading chart data...</div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Equity Analytics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-red-500 py-8">Failed to load chart data</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Chart with Sleek Header */}
      {selectedAccounts.length === 0 ? (
        <Card>
          <CardContent className="py-8">
            <div className="text-center text-muted-foreground">
              Please select at least one account to view the chart
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {/* Sleek Header with Controls */}
          <div className="border-b bg-gradient-to-r from-muted/50 to-muted/30">
            <div className="px-6 py-5">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-primary/10 ring-1 ring-primary/20">
                    <TrendingUp className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-xl font-semibold tracking-tight">Equity Growth Analytics</h3>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {timePeriod === '7d' ? 'Last 7 Days' : 
                       timePeriod === '30d' ? 'Last 30 Days' :
                       timePeriod === '90d' ? 'Last 90 Days' :
                       'Last 365 Days'} • {selectedAccounts.length} account{selectedAccounts.length !== 1 ? 's' : ''} selected
                    </p>
                  </div>
                </div>
              </div>
              
              {/* Controls Row */}
              <div className="flex flex-wrap items-end gap-4">
                {/* Account Selection - Multiselect */}
                <div className="flex-1 min-w-[300px]">
                  <label className="text-xs font-semibold text-muted-foreground mb-2 block uppercase tracking-wide">
                    Accounts
                  </label>
                  <MultiSelect
                    options={accountOptions}
                    selected={selectedAccounts}
                    onChange={setSelectedAccounts}
                    placeholder="Select accounts to compare..."
                    className="w-full"
                  />
                </div>

                {/* Time Period */}
                <div className="w-[180px]">
                  <label className="text-xs font-semibold text-muted-foreground mb-2 block uppercase tracking-wide">
                    Time Period
                  </label>
                  <Select value={timePeriod} onValueChange={(value) => setTimePeriod(value as TimePeriod)}>
                    <SelectTrigger className="w-full h-10">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <SelectValue />
                      </div>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="7d">Last 7 Days</SelectItem>
                      <SelectItem value="30d">Last 30 Days</SelectItem>
                      <SelectItem value="90d">Last 90 Days</SelectItem>
                      <SelectItem value="365d">Last 365 Days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Chart Type */}
                <div className="w-[180px]">
                  <label className="text-xs font-semibold text-muted-foreground mb-2 block uppercase tracking-wide">
                    Chart Type
                  </label>
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
                      <SelectItem value="line">
                        <div className="flex items-center gap-2">
                          <LineChartIcon className="h-4 w-4" />
                          Line Chart
                        </div>
                      </SelectItem>
                      <SelectItem value="area">
                        <div className="flex items-center gap-2">
                          <AreaChartIcon className="h-4 w-4" />
                          Area Chart
                        </div>
                      </SelectItem>
                      <SelectItem value="bar">
                        <div className="flex items-center gap-2">
                          <BarChart3 className="h-4 w-4" />
                          Bar Chart
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </div>
          <CardContent className="pt-6">
            {/* Account Summary - Moved to Top */}
            {selectedAccountsData.length > 0 && (
              <div className="mb-8 pb-6 border-b">
                <h4 className="text-sm font-semibold text-muted-foreground mb-4 uppercase tracking-wide">
                  Account Summary
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {selectedAccountsData.map((account, index) => {
                    const lastValue = chartData[chartData.length - 1]?.[account.id] || account.equity;
                    const growthPercent = account.growthPercent || 0;
                    const growth = account.growth || 0;
                    const isPositive = growthPercent >= 0;
                    
                    return (
                      <div 
                        key={account.id} 
                        className="flex items-center gap-3 p-4 border rounded-lg bg-card hover:bg-muted/50 transition-colors"
                      >
                        <div 
                          className="w-4 h-4 rounded-full flex-shrink-0 border-2 border-background shadow-sm"
                          style={{ 
                            backgroundColor: getAccountColor(account.id, index),
                          }}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-muted-foreground text-xs font-medium truncate mb-1">
                            {account.name}
                          </div>
                          <div className="text-base font-bold mb-1">
                            {formatCurrency(Number(lastValue))}
                          </div>
                          {growthPercent !== 0 && (
                            <div className={`text-xs font-semibold flex items-center gap-1 ${
                              isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                            }`}>
                              <TrendingUp className={`h-3 w-3 ${!isPositive ? 'rotate-180' : ''}`} />
                              {isPositive ? '+' : ''}{growthPercent.toFixed(2)}%
                              <span className="text-muted-foreground font-normal">
                                ({isPositive ? '+' : ''}{formatCurrency(growth)})
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            
            <div style={{ width: '100%', height: '500px' }}>
              <ResponsiveContainer width="100%" height="100%">
                {chartType === 'line' && (
                  <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis 
                      dataKey="date" 
                      className="text-xs"
                      tick={{ fill: 'currentColor', fontSize: 12 }}
                      angle={-45}
                      textAnchor="end"
                      height={80}
                    />
                    <YAxis 
                      className="text-xs"
                      tick={{ fill: 'currentColor', fontSize: 12 }}
                      tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '6px',
                      }}
                      formatter={(value: any) => formatCurrency(Number(value) || 0)}
                    />
                    <Legend 
                      wrapperStyle={{ paddingTop: '20px' }}
                      iconType="line"
                    />
                    {selectedAccountsData.map((account, index) => (
                      <Line
                        key={account.id}
                        type="monotone"
                        dataKey={account.id}
                        stroke={getAccountColor(account.id, index)}
                        strokeWidth={2}
                        dot={{ r: 3 }}
                        name={account.name}
                      />
                    ))}
                  </LineChart>
                )}
                {chartType === 'area' && (
                  <AreaChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis 
                      dataKey="date" 
                      className="text-xs"
                      tick={{ fill: 'currentColor', fontSize: 12 }}
                      angle={-45}
                      textAnchor="end"
                      height={80}
                    />
                    <YAxis 
                      className="text-xs"
                      tick={{ fill: 'currentColor', fontSize: 12 }}
                      tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '6px',
                      }}
                      formatter={(value: any) => formatCurrency(Number(value) || 0)}
                    />
                    <Legend 
                      wrapperStyle={{ paddingTop: '20px' }}
                      iconType="line"
                    />
                    {selectedAccountsData.map((account, index) => (
                      <Area
                        key={account.id}
                        type="monotone"
                        dataKey={account.id}
                        stroke={getAccountColor(account.id, index)}
                        fill={getAccountColor(account.id, index)}
                        fillOpacity={0.3}
                        strokeWidth={2}
                        name={account.name}
                      />
                    ))}
                  </AreaChart>
                )}
                {chartType === 'bar' && (
                  <BarChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis 
                      dataKey="date" 
                      className="text-xs"
                      tick={{ fill: 'currentColor', fontSize: 12 }}
                      angle={-45}
                      textAnchor="end"
                      height={80}
                    />
                    <YAxis 
                      className="text-xs"
                      tick={{ fill: 'currentColor', fontSize: 12 }}
                      tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '6px',
                      }}
                      formatter={(value: any) => formatCurrency(Number(value) || 0)}
                    />
                    <Legend 
                      wrapperStyle={{ paddingTop: '20px' }}
                    />
                    {selectedAccountsData.map((account, index) => (
                      <Bar
                        key={account.id}
                        dataKey={account.id}
                        fill={getAccountColor(account.id, index)}
                        name={account.name}
                      />
                    ))}
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

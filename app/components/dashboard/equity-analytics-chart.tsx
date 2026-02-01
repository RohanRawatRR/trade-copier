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

  if (isLoading || isLoadingHistory) {
    return (
      <Card className="overflow-hidden border-0 shadow-xl bg-gradient-to-br from-background via-background to-muted/20">
        <CardHeader className="bg-gradient-to-r from-primary/5 via-primary/10 to-primary/5 border-b pt-10">
          <CardTitle className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10 animate-pulse">
              <TrendingUp className="h-5 w-5 text-primary" />
            </div>
            <span className="bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
              Equity Analytics
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="py-12">
          <div className="flex flex-col items-center justify-center gap-3">
            <div className="h-8 w-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
            <div className="text-center text-muted-foreground font-medium">Loading chart data...</div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="overflow-hidden border-0 shadow-xl bg-gradient-to-br from-background via-background to-destructive/5">
        <CardHeader className="bg-gradient-to-r from-destructive/10 via-destructive/5 to-destructive/10 border-b border-destructive/20">
          <CardTitle className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-destructive/10">
              <TrendingUp className="h-5 w-5 text-destructive" />
            </div>
            Equity Analytics
          </CardTitle>
        </CardHeader>
        <CardContent className="py-12">
          <div className="text-center text-destructive font-medium">Failed to load chart data</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
      {/* Chart with Sleek Header */}
      {selectedAccounts.length === 0 ? (
        <Card className="overflow-hidden border-0 shadow-xl bg-gradient-to-br from-background via-background to-muted/20 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <CardContent className="py-16">
            <div className="flex flex-col items-center justify-center gap-4 animate-in fade-in zoom-in-95 duration-700 delay-150">
              <div className="p-4 rounded-2xl bg-muted/50 animate-pulse">
                <TrendingUp className="h-8 w-8 text-muted-foreground" />
              </div>
              <div className="text-center">
                <p className="text-lg font-semibold text-foreground mb-1">No Accounts Selected</p>
                <p className="text-sm text-muted-foreground">Please select at least one account to view the chart</p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden border-0 shadow-2xl bg-gradient-to-br from-background via-background to-muted/10 backdrop-blur-sm animate-in fade-in slide-in-from-bottom-4 duration-700">
          {/* Sleek Header with Controls */}
          <div className="border-b bg-gradient-to-r from-primary/5 via-primary/10 to-primary/5 backdrop-blur-sm">
            <div className="px-6 py-6">
              <div className="flex items-center justify-between mb-6 animate-in fade-in slide-in-from-left-4 duration-500">
                <div className="flex items-center gap-4">
                  <div className="relative animate-in zoom-in-95 duration-500 delay-100">
                    <div className="absolute inset-0 bg-primary/20 rounded-xl blur-lg opacity-50 animate-pulse" />
                    <div className="relative p-3 rounded-xl bg-gradient-to-br from-primary/20 to-primary/10 ring-2 ring-primary/20 shadow-lg transition-transform hover:scale-110 duration-300">
                      <TrendingUp className="h-6 w-6 text-primary" />
                    </div>
                  </div>
                  <div className="animate-in fade-in slide-in-from-left-4 duration-500 delay-200">
                    <h3 className="text-2xl font-bold tracking-tight bg-gradient-to-r from-foreground via-foreground to-foreground/70 bg-clip-text text-transparent">
                      Equity Growth Analytics
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1.5 flex items-center gap-2">
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" />
                        {timePeriod === '7d' ? 'Last 7 Days' : 
                         timePeriod === '30d' ? 'Last 30 Days' :
                         timePeriod === '90d' ? 'Last 90 Days' :
                         'Last 365 Days'}
                      </span>
                      <span className="text-muted-foreground/60">•</span>
                      <span className="font-medium text-foreground/80">
                        {selectedAccounts.length} account{selectedAccounts.length !== 1 ? 's' : ''} selected
                      </span>
                    </p>
                  </div>
                </div>
              </div>
              
              {/* Controls Row */}
              <div className="flex flex-wrap items-end gap-4 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-300">
                {/* Account Selection - Multiselect */}
                <div className="flex-1 min-w-[300px] animate-in fade-in slide-in-from-left-4 duration-500 delay-300">
                  <label className="text-xs font-bold text-foreground/70 mb-2.5 block uppercase tracking-wider">
                    Accounts
                  </label>
                  <div className="relative">
                    <MultiSelect
                      options={accountOptions}
                      selected={selectedAccounts}
                      onChange={setSelectedAccounts}
                      placeholder="Select accounts to compare..."
                      className="w-full bg-background/50 backdrop-blur-sm border-border/50 hover:border-primary/30 transition-all duration-300 hover:scale-[1.02]"
                    />
                  </div>
                </div>

                {/* Time Period */}
                <div className="w-[180px] animate-in fade-in slide-in-from-bottom-4 duration-500 delay-400">
                  <label className="text-xs font-bold text-foreground/70 mb-2.5 block uppercase tracking-wider">
                    Time Period
                  </label>
                  <Select value={timePeriod} onValueChange={(value) => setTimePeriod(value as TimePeriod)}>
                    <SelectTrigger className="w-full h-11 bg-background/50 backdrop-blur-sm border-border/50 hover:border-primary/30 transition-all duration-300 shadow-sm hover:scale-[1.02] hover:shadow-md">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-primary/70 transition-transform group-hover:rotate-12" />
                        <SelectValue />
                      </div>
                    </SelectTrigger>
                    <SelectContent className="backdrop-blur-sm animate-in fade-in zoom-in-95 duration-200">
                      <SelectItem value="7d">Last 7 Days</SelectItem>
                      <SelectItem value="30d">Last 30 Days</SelectItem>
                      <SelectItem value="90d">Last 90 Days</SelectItem>
                      <SelectItem value="365d">Last 365 Days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Chart Type */}
                <div className="w-[180px] animate-in fade-in slide-in-from-right-4 duration-500 delay-500">
                  <label className="text-xs font-bold text-foreground/70 mb-2.5 block uppercase tracking-wider">
                    Chart Type
                  </label>
                  <Select value={chartType} onValueChange={(value) => setChartType(value as ChartType)}>
                    <SelectTrigger className="w-full h-11 bg-background/50 backdrop-blur-sm border-border/50 hover:border-primary/30 transition-all duration-300 shadow-sm hover:scale-[1.02] hover:shadow-md">
                      <div className="flex items-center gap-2">
                        {chartType === 'line' && <LineChartIcon className="h-4 w-4 text-primary/70 transition-transform group-hover:scale-110" />}
                        {chartType === 'area' && <AreaChartIcon className="h-4 w-4 text-primary/70 transition-transform group-hover:scale-110" />}
                        {chartType === 'bar' && <BarChart3 className="h-4 w-4 text-primary/70 transition-transform group-hover:scale-110" />}
                        <SelectValue />
                      </div>
                    </SelectTrigger>
                    <SelectContent className="backdrop-blur-sm animate-in fade-in zoom-in-95 duration-200">
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
          <CardContent className="pt-8">
            {/* Account Summary - Moved to Top */}
            {selectedAccountsData.length > 0 && (
              <div className="mb-10 pb-8 border-b border-border/50 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-400">
                <div className="flex items-center gap-2 mb-6 animate-in fade-in duration-500 delay-500">
                  <div className="h-px flex-1 bg-gradient-to-r from-transparent via-border to-transparent animate-in slide-in-from-left-4 duration-700 delay-500" />
                  <h4 className="text-sm font-bold text-foreground/80 px-4 uppercase tracking-widest">
                    Account Summary
                  </h4>
                  <div className="h-px flex-1 bg-gradient-to-r from-transparent via-border to-transparent animate-in slide-in-from-right-4 duration-700 delay-500" />
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {selectedAccountsData.map((account, index) => {
                    // Use current equity from balances API, not historical chart data
                    const currentEquity = account.equity || 0;
                    const growthPercent = account.growthPercent || 0;
                    const growth = account.growth || 0;
                    const isPositive = growthPercent >= 0;
                    const accountColor = getAccountColor(account.id, index);
                    
                    return (
                      <div 
                        key={account.id} 
                        className="group relative overflow-hidden rounded-lg border border-border/50 bg-gradient-to-br from-card via-card to-muted/20 px-3.5 py-2.5 shadow-sm hover:shadow-lg hover:border-primary/30 transition-all duration-300 hover:-translate-y-1 animate-in fade-in slide-in-from-bottom-4 zoom-in-95"
                        style={{
                          animationDelay: `${index * 100}ms`,
                          animationDuration: '500ms',
                          animationFillMode: 'both',
                        }}
                      >
                        {/* Gradient overlay on hover */}
                        <div 
                          className="absolute inset-0 opacity-0 group-hover:opacity-10 transition-opacity duration-300"
                          style={{ 
                            background: `linear-gradient(135deg, ${accountColor}20, ${accountColor}05)`,
                          }}
                        />
                        
                        <div className="relative flex items-start justify-between gap-3 w-full">
                          {/* Left side: Color indicator and account name */}
                          <div className="flex items-start gap-2.5 flex-1 min-w-0">
                            {/* Color indicator with glow effect */}
                            <div className="relative flex-shrink-0 mt-0.5">
                              <div 
                                className="absolute inset-0 rounded-full blur-md opacity-30 group-hover:opacity-50 transition-all duration-300 group-hover:scale-125"
                                style={{ backgroundColor: accountColor }}
                              />
                              <div 
                                className="relative w-4 h-4 rounded-full border-2 border-background shadow-lg transition-transform duration-300 group-hover:scale-110 group-hover:rotate-12"
                                style={{ backgroundColor: accountColor }}
                              />
                            </div>
                            
                            <div className="flex-1 min-w-0">
                              <div className="text-muted-foreground text-xs font-semibold truncate uppercase tracking-wide mb-1">
                                {account.name}
                              </div>
                              <div className="text-lg font-bold bg-gradient-to-r from-foreground to-foreground/80 bg-clip-text text-transparent">
                                {formatCurrency(Number(currentEquity))}
                              </div>
                            </div>
                          </div>
                          
                          {/* Right side: Growth percentage */}
                          {growthPercent !== 0 && (
                            <div className="flex-shrink-0 flex flex-col items-end justify-start pr-1">
                              <div className={`text-xs font-bold flex items-center gap-1 ${
                                isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                              }`}>
                                <div className={`p-0.5 rounded ${
                                  isPositive ? 'bg-green-500/10' : 'bg-red-500/10'
                                }`}>
                                  <TrendingUp className={`h-3 w-3 ${!isPositive ? 'rotate-180' : ''}`} />
                                </div>
                                <span>
                                  {isPositive ? '+' : ''}{growthPercent.toFixed(2)}%
                                </span>
                              </div>
                              <span className="text-xs font-medium text-muted-foreground mt-0.5">
                                {isPositive ? '+' : ''}{formatCurrency(growth)}
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
            
            <div className="relative animate-in fade-in zoom-in-95 duration-700 delay-600" style={{ width: '100%', height: '550px' }}>
              {/* Chart background gradient */}
              <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/5 rounded-lg opacity-50 animate-pulse" />
              <ResponsiveContainer width="100%" height="100%" className="animate-in fade-in duration-700 delay-700">
                {chartType === 'line' && (
                  <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
                    <defs>
                      {selectedAccountsData.map((account, index) => {
                        const color = getAccountColor(account.id, index);
                        return (
                          <linearGradient key={account.id} id={`gradient-${account.id}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                            <stop offset="100%" stopColor={color} stopOpacity={0} />
                          </linearGradient>
                        );
                      })}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                    <XAxis 
                      dataKey="date" 
                      className="text-xs"
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11, fontWeight: 500 }}
                      angle={-45}
                      textAnchor="end"
                      height={80}
                      stroke="hsl(var(--border))"
                    />
                    <YAxis 
                      className="text-xs"
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11, fontWeight: 500 }}
                      tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                      stroke="hsl(var(--border))"
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                        padding: '12px',
                      }}
                      labelStyle={{
                        fontWeight: 600,
                        marginBottom: '8px',
                      }}
                      formatter={(value: any) => formatCurrency(Number(value) || 0)}
                    />
                    <Legend 
                      wrapperStyle={{ paddingTop: '24px' }}
                      iconType="line"
                      iconSize={12}
                    />
                    {selectedAccountsData.map((account, index) => (
                      <Line
                        key={account.id}
                        type="monotone"
                        dataKey={account.id}
                        stroke={getAccountColor(account.id, index)}
                        strokeWidth={3}
                        dot={{ r: 4, fill: getAccountColor(account.id, index), strokeWidth: 2, stroke: '#fff' }}
                        activeDot={{ r: 6, stroke: getAccountColor(account.id, index), strokeWidth: 2 }}
                        name={account.name}
                      />
                    ))}
                  </LineChart>
                )}
                {chartType === 'area' && (
                  <AreaChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
                    <defs>
                      {selectedAccountsData.map((account, index) => {
                        const color = getAccountColor(account.id, index);
                        return (
                          <linearGradient key={account.id} id={`areaGradient-${account.id}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={color} stopOpacity={0.4} />
                            <stop offset="100%" stopColor={color} stopOpacity={0.05} />
                          </linearGradient>
                        );
                      })}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                    <XAxis 
                      dataKey="date" 
                      className="text-xs"
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11, fontWeight: 500 }}
                      angle={-45}
                      textAnchor="end"
                      height={80}
                      stroke="hsl(var(--border))"
                    />
                    <YAxis 
                      className="text-xs"
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11, fontWeight: 500 }}
                      tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                      stroke="hsl(var(--border))"
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                        padding: '12px',
                      }}
                      labelStyle={{
                        fontWeight: 600,
                        marginBottom: '8px',
                      }}
                      formatter={(value: any) => formatCurrency(Number(value) || 0)}
                    />
                    <Legend 
                      wrapperStyle={{ paddingTop: '24px' }}
                      iconType="line"
                      iconSize={12}
                    />
                    {selectedAccountsData.map((account, index) => (
                      <Area
                        key={account.id}
                        type="monotone"
                        dataKey={account.id}
                        stroke={getAccountColor(account.id, index)}
                        fill={`url(#areaGradient-${account.id})`}
                        strokeWidth={3}
                        name={account.name}
                      />
                    ))}
                  </AreaChart>
                )}
                {chartType === 'bar' && (
                  <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
                    <defs>
                      {selectedAccountsData.map((account, index) => {
                        const color = getAccountColor(account.id, index);
                        return (
                          <linearGradient key={account.id} id={`barGradient-${account.id}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={color} stopOpacity={0.9} />
                            <stop offset="100%" stopColor={color} stopOpacity={0.6} />
                          </linearGradient>
                        );
                      })}
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                    <XAxis 
                      dataKey="date" 
                      className="text-xs"
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11, fontWeight: 500 }}
                      angle={-45}
                      textAnchor="end"
                      height={80}
                      stroke="hsl(var(--border))"
                    />
                    <YAxis 
                      className="text-xs"
                      tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 11, fontWeight: 500 }}
                      tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`}
                      stroke="hsl(var(--border))"
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '8px',
                        boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                        padding: '12px',
                      }}
                      labelStyle={{
                        fontWeight: 600,
                        marginBottom: '8px',
                      }}
                      formatter={(value: any) => formatCurrency(Number(value) || 0)}
                    />
                    <Legend 
                      wrapperStyle={{ paddingTop: '24px' }}
                      iconSize={12}
                    />
                    {selectedAccountsData.map((account, index) => (
                      <Bar
                        key={account.id}
                        dataKey={account.id}
                        fill={`url(#barGradient-${account.id})`}
                        radius={[4, 4, 0, 0]}
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

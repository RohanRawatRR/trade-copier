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
type TimePeriod = '7d' | '30d' | '90d' | '1y' | 'all';

interface EquityDataPoint {
  date: string;
  [accountId: string]: string | number;
}

export function EquityAnalyticsChart() {
  const [selectedAccounts, setSelectedAccounts] = useState<string[]>([]);
  const [timePeriod, setTimePeriod] = useState<TimePeriod>('7d');
  const [chartType, setChartType] = useState<ChartType>('line');

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

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  // Prepare accounts list
  const allAccounts = useMemo(() => {
    const accounts: Array<{ id: string; name: string; equity: number; type: 'master' | 'client' }> = [];
    
    if (data?.data) {
      if (data.data.master && data.data.master.status === 'success') {
        accounts.push({
          id: 'master',
          name: `Master (${data.data.master.account_id})`,
          equity: data.data.master.equity || 0,
          type: 'master',
        });
      }
      
      data.data.clients?.forEach((balance: any) => {
        if (balance.status === 'success') {
          accounts.push({
            id: `client_${balance.account_id}`,
            name: balance.account_name || balance.account_id,
            equity: balance.equity || 0,
            type: 'client',
          });
        }
      });
    }
    
    return accounts;
  }, [data]);

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

  // Calculate days based on time period
  const getDaysCount = (period: TimePeriod): number => {
    switch (period) {
      case '7d': return 7;
      case '30d': return 30;
      case '90d': return 90;
      case '1y': return 365;
      case 'all': return 365; // For now, limit to 1 year
      default: return 7;
    }
  };

  // Prepare chart data
  const chartData: EquityDataPoint[] = useMemo(() => {
    const days = getDaysCount(timePeriod);
    const now = new Date();
    const dataPoints: EquityDataPoint[] = [];
    
    // Get selected accounts data
    const selectedAccountsData = allAccounts.filter(acc => selectedAccounts.includes(acc.id));
    
    // Create data points for the selected time period
    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      
      const dataPoint: EquityDataPoint = {
        date: format(date, days <= 30 ? 'MMM dd' : 'MMM dd, yyyy'),
      };
      
      // Add equity value for each selected account
      selectedAccountsData.forEach((account) => {
        dataPoint[account.id] = account.equity; // Using current equity for all dates (placeholder)
      });
      
      dataPoints.push(dataPoint);
    }
    
    return dataPoints;
  }, [allAccounts, selectedAccounts, timePeriod]);

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

  if (isLoading) {
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
                       timePeriod === '1y' ? 'Last Year' : 'All Time'} • {selectedAccounts.length} account{selectedAccounts.length !== 1 ? 's' : ''} selected
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
                      <SelectItem value="1y">Last Year</SelectItem>
                      <SelectItem value="all">All Time</SelectItem>
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
            
            {/* Summary Stats */}
            <div className="mt-8 pt-6 border-t">
              <h4 className="text-sm font-semibold text-muted-foreground mb-4 uppercase tracking-wide">
                Account Summary
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                {selectedAccountsData.map((account, index) => {
                  const lastValue = chartData[chartData.length - 1]?.[account.id] || 0;
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
                        <div className="text-base font-bold">
                          {formatCurrency(Number(lastValue))}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

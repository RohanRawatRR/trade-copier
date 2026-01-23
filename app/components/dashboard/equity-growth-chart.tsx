'use client';

// Equity Growth Chart - Shows equity trends for master and client accounts

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { TrendingUp } from 'lucide-react';
import { format } from 'date-fns';

interface EquityDataPoint {
  date: string;
  [accountId: string]: string | number; // Dynamic keys for each account
}

export function EquityGrowthChart() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['account-balances'],
    queryFn: async () => {
      const response = await fetch('/api/accounts/balances');
      if (!response.ok) throw new Error('Failed to fetch balances');
      return response.json();
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Debug logging
  console.log('EquityGrowthChart render:', { isLoading, hasData: !!data?.data, error: error?.message });

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  };

  // Prepare chart data - individual accounts
  const chartData: EquityDataPoint[] = [];
  const accountColors: Record<string, string> = {};
  const accounts: Array<{ id: string; name: string; equity: number }> = [];
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
  
  if (data?.data) {
    const masterBalance = data.data.master;
    const clientBalances = data.data.clients || [];
    
    // Build account list: master first, then clients
    if (masterBalance && masterBalance.status === 'success') {
      accounts.push({
        id: 'master',
        name: `Master (${masterBalance.account_id})`,
        equity: masterBalance.equity || 0,
      });
      accountColors['master'] = colorPalette[0];
    }
    
    clientBalances.forEach((balance: any, index: number) => {
      if (balance.status === 'success') {
        const accountId = `client_${balance.account_id}`;
        accounts.push({
          id: accountId,
          name: balance.account_name || balance.account_id,
          equity: balance.equity || 0,
        });
        accountColors[accountId] = colorPalette[(index % (colorPalette.length - 1)) + 1];
      }
    });

    // Always create chart data, even with zero values, so the chart is visible
    // For now, we'll show current equity values
    // In the future, this can be extended to show historical data
    const now = new Date();
    
    // Create data points for the last 7 days (using current values for demo)
    // In production, you'd fetch historical data from a time-series database
    for (let i = 6; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      
      const dataPoint: EquityDataPoint = {
        date: format(date, 'MMM dd'),
      };
      
      // Add equity value for each account
      accounts.forEach((account) => {
        dataPoint[account.id] = account.equity;
      });
      
      chartData.push(dataPoint);
    }
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Equity Growth
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
            Equity Growth
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-red-500 py-8">Failed to load chart data</div>
        </CardContent>
      </Card>
    );
  }

  if (chartData.length === 0) {
    console.log('EquityGrowthChart: No chart data', { 
      hasData: !!data?.data, 
      masterBalance: data?.data?.master, 
      clientBalances: data?.data?.clients?.length 
    });
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Equity Growth
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground py-8">
            No data available
            {data?.data && (
              <div className="mt-2 text-xs">
                Master: {data.data.master?.equity || 0} | 
                Clients: {data.data.clients?.length || 0}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (chartData.length === 0 || accounts.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Equity Growth
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground py-8">
            No account data available
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          Equity Growth by Account (Last 7 Days)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div style={{ width: '100%', height: '400px' }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis 
                dataKey="date" 
                className="text-xs"
                tick={{ fill: 'currentColor', fontSize: 12 }}
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
              {accounts.map((account, index) => (
                <Line
                  key={account.id}
                  type="monotone"
                  dataKey={account.id}
                  stroke={accountColors[account.id] || colorPalette[index % colorPalette.length]}
                  strokeWidth={2}
                  dot={{ r: 3 }}
                  name={account.name}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
        
        {/* Summary Stats - Individual Accounts */}
        <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-sm">
          {accounts.map((account) => {
            const lastValue = chartData[chartData.length - 1]?.[account.id] || 0;
            return (
              <div key={account.id} className="flex items-center gap-2">
                <div 
                  className="w-3 h-3 rounded-full flex-shrink-0"
                  style={{ backgroundColor: accountColors[account.id] || colorPalette[0] }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-muted-foreground text-xs truncate">
                    {account.name}
                  </div>
                  <div className="font-semibold">
                    {formatCurrency(Number(lastValue))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

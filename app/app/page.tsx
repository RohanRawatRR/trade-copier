'use client';

// Main Dashboard Page

import { useQuery } from '@tanstack/react-query';
import { StatsCard } from '@/components/dashboard/stats-card';
import { TradeTimeline } from '@/components/dashboard/trade-timeline';
import { ClientBalancesTable } from '@/components/dashboard/client-balances-table';
import { Activity, CheckCircle2, XCircle, Clock, Users } from 'lucide-react';

export default function DashboardPage() {
  // Fetch trade statistics
  const { data: stats } = useQuery({
    queryKey: ['trade-stats', 'today'],
    queryFn: async () => {
      const response = await fetch('/api/trades/stats?period=today');
      if (!response.ok) throw new Error('Failed to fetch stats');
      return response.json();
    },
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  // Fetch clients count
  const { data: clients } = useQuery({
    queryKey: ['clients'],
    queryFn: async () => {
      const response = await fetch('/api/clients');
      if (!response.ok) throw new Error('Failed to fetch clients');
      return response.json();
    },
  });

  const tradeStats = stats?.data || {};
  const clientsData = clients?.data || [];
  const activeClients = clientsData.filter((c: any) => c.is_active).length;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">Trade Copier Dashboard</h1>
              <p className="text-muted-foreground mt-1">
                Real-time monitoring and management for Alpaca trade replication
          </p>
        </div>
            <nav className="flex gap-4">
              <a
                href="/clients"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Clients
              </a>
              <a
                href="/trades"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Trades
          </a>
          <a
                href="/settings"
                className="text-sm text-muted-foreground hover:text-foreground transition-colors"
              >
                Settings
              </a>
            </nav>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        {/* Stats Overview */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          <StatsCard
            title="Total Trades Today"
            value={tradeStats.total_trades || 0}
            description="Across all clients"
            icon={Activity}
          />
          <StatsCard
            title="Successful Trades"
            value={tradeStats.successful_trades || 0}
            description={`${tradeStats.success_rate || 0}% success rate`}
            icon={CheckCircle2}
          />
          <StatsCard
            title="Failed Trades"
            value={tradeStats.failed_trades || 0}
            description={`${tradeStats.skipped_trades || 0} skipped`}
            icon={XCircle}
          />
          <StatsCard
            title="Avg Latency"
            value={`${tradeStats.avg_latency_ms || 0}ms`}
            description="Trade execution time"
            icon={Clock}
          />
        </div>

        {/* Active Clients */}
        <div className="mb-8">
          <StatsCard
            title="Active Clients"
            value={`${activeClients} / ${clientsData.length}`}
            description="Total client accounts"
            icon={Users}
          />
        </div>

        {/* Two Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          {/* Recent Trades */}
          <TradeTimeline limit={15} />

          {/* Client Balances */}
          <ClientBalancesTable />
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t mt-12">
        <div className="container mx-auto px-4 py-6 text-center text-sm text-muted-foreground">
          <p>Trade Copier Dashboard v1.0 | Alpaca Markets Integration</p>
        </div>
      </footer>
    </div>
  );
}

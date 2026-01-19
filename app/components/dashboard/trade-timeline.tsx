'use client';

// Trade Timeline Component - Shows recent trades in real-time

import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { TradeAuditLog } from '@/types';
import { formatDistanceToNow } from 'date-fns';
import { CheckCircle2, XCircle, AlertCircle, TrendingUp, TrendingDown } from 'lucide-react';

export function TradeTimeline({ limit = 10 }: { limit?: number }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['trades', { limit }],
    queryFn: async () => {
      const response = await fetch(`/api/trades?limit=${limit}`);
      if (!response.ok) throw new Error('Failed to fetch trades');
      return response.json();
    },
    refetchInterval: 5000, // Refresh every 5 seconds
  });

  const trades: TradeAuditLog[] = data?.data?.trades || [];

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Recent Trades</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground py-8">Loading...</div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Recent Trades</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-red-500 py-8">Failed to load trades</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Trades</CardTitle>
      </CardHeader>
      <CardContent>
        {trades.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            No trades yet
          </div>
        ) : (
          <div className="space-y-4">
            {trades.map((trade: any) => {
              // Safely parse the datetime string
              const tradeDate = trade.replication_started_at 
                ? new Date(trade.replication_started_at)
                : null;
              
              const isValidDate = tradeDate && !isNaN(tradeDate.getTime());
              
              return (
                <div
                  key={trade.id}
                  className="flex items-start gap-3 border-l-2 pl-3 py-2 hover:bg-accent/50 transition-colors"
                  style={{
                    borderLeftColor:
                      trade.status === 'success'
                        ? '#22c55e'
                        : trade.status === 'failed'
                        ? '#ef4444'
                        : '#f59e0b',
                  }}
                >
                  <div className="mt-0.5">
                    {trade.status === 'success' ? (
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    ) : trade.status === 'failed' ? (
                      <XCircle className="h-5 w-5 text-red-500" />
                    ) : (
                      <AlertCircle className="h-5 w-5 text-yellow-500" />
                    )}
                  </div>
                  <div className="flex-1 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{trade.symbol}</span>
                      <Badge
                        variant={trade.side === 'buy' ? 'default' : 'destructive'}
                        className="text-xs"
                      >
                        {trade.side === 'buy' ? (
                          <><TrendingUp className="h-3 w-3 mr-1" /> BUY</>
                        ) : (
                          <><TrendingDown className="h-3 w-3 mr-1" /> SELL</>
                        )}
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {trade.status}
                      </Badge>
                    </div>
                    <div className="text-sm text-muted-foreground">
                      Master: {trade.master_qty} shares → Client ({trade.client_account_id}): {trade.client_qty?.toFixed(4) || 'N/A'} shares
                    </div>
                    {trade.replication_latency_ms && (
                      <div className="text-xs text-muted-foreground">
                        Latency: {trade.replication_latency_ms}ms
                      </div>
                    )}
                    {trade.error_message && (
                      <div className="text-xs text-red-500 mt-1">
                        Error: {trade.error_message}
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground">
                      {isValidDate 
                        ? formatDistanceToNow(tradeDate, { addSuffix: true })
                        : trade.replication_started_at || 'Unknown time'}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}


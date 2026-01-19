'use client';

// Trades History Page - Full trade audit log

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Home, Search, RefreshCw } from 'lucide-react';
import { TradeAuditLog } from '@/types';
import { format } from 'date-fns';

export default function TradesPage() {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [symbolFilter, setSymbolFilter] = useState<string>('');
  const [limit, setLimit] = useState(100);

  // Fetch trades with filters
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['trades', statusFilter, symbolFilter, limit],
    queryFn: async () => {
      const params = new URLSearchParams({
        limit: limit.toString(),
      });
      if (statusFilter !== 'all') params.append('status', statusFilter);
      if (symbolFilter) params.append('symbol', symbolFilter.toUpperCase());

      const response = await fetch(`/api/trades?${params}`);
      if (!response.ok) throw new Error('Failed to fetch trades');
      return response.json();
    },
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  const trades: TradeAuditLog[] = data?.data?.trades || [];
  const pagination = data?.data?.pagination || {};

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success':
        return 'default';
      case 'failed':
        return 'destructive';
      case 'skipped':
        return 'secondary';
      default:
        return 'outline';
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold">Trade History</h1>
              <p className="text-muted-foreground mt-1">
                Complete audit log of all trade replications
              </p>
            </div>
            <a href="/">
              <Button variant="outline">
                <Home className="mr-2 h-4 w-4" />
                Dashboard
              </Button>
            </a>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <Card>
          <CardHeader>
            <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
              <CardTitle>
                All Trades ({pagination.total || 0})
              </CardTitle>
              <div className="flex gap-2 items-center w-full md:w-auto">
                {/* Status Filter */}
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-[140px]">
                    <SelectValue placeholder="Status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Status</SelectItem>
                    <SelectItem value="success">Success</SelectItem>
                    <SelectItem value="failed">Failed</SelectItem>
                    <SelectItem value="skipped">Skipped</SelectItem>
                  </SelectContent>
                </Select>

                {/* Symbol Filter */}
                <div className="relative flex-1 md:w-[200px]">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Filter by symbol..."
                    value={symbolFilter}
                    onChange={(e) => setSymbolFilter(e.target.value)}
                    className="pl-8"
                  />
                </div>

                {/* Refresh */}
                <Button variant="outline" size="icon" onClick={() => refetch()}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8">Loading trades...</div>
            ) : trades.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No trades found matching your filters.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Time</TableHead>
                      <TableHead>Symbol</TableHead>
                      <TableHead>Side</TableHead>
                      <TableHead>Master Qty</TableHead>
                      <TableHead>Client Qty</TableHead>
                      <TableHead>Client ID</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Latency</TableHead>
                      <TableHead>Details</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {trades.map((trade: any) => {
                      // Safely parse the datetime string
                      const tradeDate = trade.replication_started_at 
                        ? new Date(trade.replication_started_at)
                        : null;
                      
                      const isValidDate = tradeDate && !isNaN(tradeDate.getTime());
                      
                      return (
                        <TableRow key={trade.id}>
                          <TableCell className="text-xs">
                            {isValidDate 
                              ? format(tradeDate, 'MMM dd, HH:mm:ss')
                              : trade.replication_started_at || 'N/A'}
                          </TableCell>
                          <TableCell className="font-semibold">
                            {trade.symbol}
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant={trade.side === 'buy' ? 'default' : 'destructive'}
                              className="text-xs"
                            >
                              {trade.side.toUpperCase()}
                            </Badge>
                          </TableCell>
                          <TableCell>{trade.master_qty}</TableCell>
                          <TableCell>
                            {trade.client_qty ? trade.client_qty.toFixed(4) : '-'}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {trade.client_account_id}
                          </TableCell>
                          <TableCell>
                            <Badge variant={getStatusColor(trade.status)}>
                              {trade.status}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {trade.replication_latency_ms ? `${trade.replication_latency_ms}ms` : '-'}
                          </TableCell>
                          <TableCell>
                            {trade.error_message && (
                              <div className="text-xs text-red-500 max-w-xs truncate" title={trade.error_message}>
                                {trade.error_message}
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>

                {/* Pagination Info */}
                <div className="mt-4 text-sm text-muted-foreground text-center">
                  Showing {trades.length} of {pagination.total} trades
                  {pagination.hasMore && ' (Load more feature coming soon)'}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

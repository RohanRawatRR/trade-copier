'use client';

// Open Positions Page - Shows open trades on client accounts

import { useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { AppHeader } from '@/components/dashboard/app-header';
import { TrendingUp, XCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/providers/toast-provider';
import { Alert, AlertDescription } from '@/components/ui/alert';

export default function PositionsPage() {
  const [symbolFilter, setSymbolFilter] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [isClosingAll, setIsClosingAll] = useState(false);
  const [closeSummary, setCloseSummary] = useState<null | { closed: number; failed: number; message: string }>(null);
  const { showSuccess, showError } = useToast();

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['open-positions'],
    queryFn: async () => {
      const res = await fetch('/api/accounts/positions');
      if (!res.ok) throw new Error('Failed to fetch positions');
      return res.json();
    },
    refetchInterval: 30000,
  });

  const clients = data?.data?.clients || [];
  const summary = data?.data?.summary || {};

  const filtered = useMemo(() => {
    const s = symbolFilter.trim().toUpperCase();
    const c = clientFilter.trim().toLowerCase();
    return clients
      .map((cl: any) => ({
        ...cl,
        positions: (cl.positions || []).filter((p: any) => {
          const bySymbol = s ? p.symbol?.toUpperCase().includes(s) : true;
          const byClient = c
            ? cl.account_id.toLowerCase().includes(c) || (cl.account_name || '').toLowerCase().includes(c)
            : true;
          return bySymbol && byClient;
        }),
      }))
      .filter((cl: any) => cl.positions.length > 0);
  }, [clients, symbolFilter, clientFilter]);

  const formatCurrency = (value: number | null | undefined) => {
    if (value === null || value === undefined) return '-';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const formatPct = (value: number | null | undefined) => {
    if (value === null || value === undefined) return '-';
    const pct = (value * 100).toFixed(2);
    return `${pct}%`;
  };

  const closeAllMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/trades/close-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || err.message || 'Failed to close all positions');
      }
      return response.json();
    },
    onSuccess: (res) => {
      setIsClosingAll(false);
      showSuccess(res.message || 'Closed all positions', 'Close All Positions');
      setCloseSummary({
        closed: Number(res?.data?.closed || 0),
        failed: Number(res?.data?.failed || 0),
        message: res.message || 'Closed all positions',
      });
      refetch();
    },
    onError: (error: Error) => {
      setIsClosingAll(false);
      showError(error.message || 'Failed to close all positions', 'Close All Failed');
    },
  });

  const handleCloseAll = async () => {
    if (!confirm('Close all open positions for all client accounts? This cannot be undone.')) return;
    setIsClosingAll(true);
    closeAllMutation.mutate();
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader title="Open Positions" description="Current open trades across client accounts" />

      <main className="container mx-auto px-4 py-8">
        <Card className="mb-6">
          <CardHeader className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" /> Open Positions
            </CardTitle>
            <div className="flex gap-2 w-full md:w-auto items-center">
              {/* Close All first */}
              <Button
                variant="destructive"
                onClick={handleCloseAll}
                disabled={closeAllMutation.isPending || isClosingAll}
                className="gap-2"
              >
                {closeAllMutation.isPending || isClosingAll ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Closing...
                  </>
                ) : (
                  <>
                    <XCircle className="h-4 w-4" />
                    Close All Positions
                  </>
                )}
              </Button>

              {/* Filters */}
              <Input
                placeholder="Filter by symbol..."
                value={symbolFilter}
                onChange={(e) => setSymbolFilter(e.target.value)}
                className="md:w-[200px]"
              />
              <Input
                placeholder="Filter by client..."
                value={clientFilter}
                onChange={(e) => setClientFilter(e.target.value)}
                className="md:w-[220px]"
              />

              {/* Refresh as icon at last */}
              <Button
                variant="outline"
                size="icon"
                onClick={() => refetch()}
                title="Refresh"
                aria-label="Refresh"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </CardHeader>
          {closeSummary && (
            <div className="px-6">
              <Alert className="mb-4">
                <AlertDescription>
                  {closeSummary.message} • Closed: {closeSummary.closed} • Failed: {closeSummary.failed}
                  <button
                    className="ml-3 text-xs underline text-muted-foreground hover:text-foreground"
                    onClick={() => setCloseSummary(null)}
                  >
                    Dismiss
                  </button>
                </AlertDescription>
              </Alert>
            </div>
          )}
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8 text-muted-foreground">Loading positions...</div>
            ) : error ? (
              <div className="text-center py-8 text-red-500">Failed to load positions</div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No open positions found.</div>
            ) : (
              <div className="space-y-8">
                {filtered.map((client: any) => (
                  <div key={client.account_id}>
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <div className="font-mono text-sm">{client.account_id}</div>
                        {client.account_name && (
                          <div className="text-xs text-muted-foreground">{client.account_name}</div>
                        )}
                      </div>
                      <Badge variant="outline">{client.positions.length} position(s)</Badge>
                    </div>
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Symbol</TableHead>
                            <TableHead className="text-right">Qty</TableHead>
                            <TableHead>Side</TableHead>
                            <TableHead className="text-right">Avg Entry</TableHead>
                            <TableHead className="text-right">Current</TableHead>
                            <TableHead className="text-right">Market Value</TableHead>
                            <TableHead className="text-right">Unrealized P/L</TableHead>
                            <TableHead className="text-right">Unrealized P/L %</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {client.positions.map((p: any) => (
                            <TableRow key={`${client.account_id}-${p.symbol}`}>
                              <TableCell className="font-semibold">{p.symbol}</TableCell>
                              <TableCell className="text-right">{p.qty}</TableCell>
                              <TableCell>
                                <Badge variant={p.side === 'long' ? 'default' : 'destructive'} className="text-xs">
                                  {p.side.toUpperCase()}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-right">{formatCurrency(p.avg_entry_price)}</TableCell>
                              <TableCell className="text-right">{formatCurrency(p.current_price)}</TableCell>
                              <TableCell className="text-right">{formatCurrency(p.market_value)}</TableCell>
                              <TableCell className="text-right">
                                {p.unrealized_pl === null ? (
                                  <span className="text-muted-foreground">-</span>
                                ) : (
                                  <span className={p.unrealized_pl >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                                    {formatCurrency(p.unrealized_pl)}
                                  </span>
                                )}
                              </TableCell>
                              <TableCell className="text-right">
                                {p.unrealized_plpc === null ? (
                                  <span className="text-muted-foreground">-</span>
                                ) : (
                                  <span className={p.unrealized_plpc >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
                                    {formatPct(p.unrealized_plpc)}
                                  </span>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Summary */}
        {summary && (
          <div className="text-sm text-muted-foreground">
            Total clients: {summary.total_clients} • Clients with positions: {summary.clients_with_positions} • Total positions: {summary.total_positions}
          </div>
        )}
      </main>
    </div>
  );
}

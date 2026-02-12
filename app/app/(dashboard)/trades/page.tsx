'use client';

// Trades History Page - Full trade audit log

import { useState, Fragment } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
import { Search, RefreshCw, RotateCcw, Check, X, XCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import { TradeAuditLog } from '@/types';
import { format } from 'date-fns';
import { AppHeader } from '@/components/dashboard/app-header';
import { useToast } from '@/components/providers/toast-provider';
import { TradeDetailDialog } from '@/components/dashboard/trade-detail-dialog';

export default function TradesPage() {
  const queryClient = useQueryClient();
  const { showSuccess, showError } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [symbolFilter, setSymbolFilter] = useState<string>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [retryingTradeId, setRetryingTradeId] = useState<number | null>(null);
  const [retryQuantities, setRetryQuantities] = useState<Record<number, string>>({});
  const [selectedTrade, setSelectedTrade] = useState<any | null>(null);
  const [isDetailDialogOpen, setIsDetailDialogOpen] = useState(false);
  const [isClosingAll, setIsClosingAll] = useState(false);

  // Fetch trades with filters
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['trades', statusFilter, symbolFilter, page, pageSize],
    queryFn: async () => {
      const offset = (page - 1) * pageSize;
      const params = new URLSearchParams({
        limit: pageSize.toString(),
        offset: offset.toString(),
      });
      if (statusFilter !== 'all') params.append('status', statusFilter);
      if (symbolFilter) params.append('symbol', symbolFilter.toUpperCase());

      const response = await fetch(`/api/trades?${params}`);
      if (!response.ok) throw new Error('Failed to fetch trades');
      return response.json();
    },
    refetchInterval: 10000, // Refresh every 10 seconds
  });

  // Reset to page 1 when filters change
  const handleFilterChange = (filterType: 'status' | 'symbol', value: string) => {
    setPage(1);
    if (filterType === 'status') setStatusFilter(value);
    if (filterType === 'symbol') setSymbolFilter(value);
  };

  // Retry trade mutation
  const retryTradeMutation = useMutation({
    mutationFn: async ({ trade }: { trade: any; qty: number }) => {
      const response = await fetch('/api/trades/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_account_id: trade.client_account_id,
          symbol: trade.symbol,
          side: trade.side,
          qty: parseFloat(retryQuantities[trade.id] || trade.client_qty?.toString() || trade.master_qty.toString()),
          order_type: trade.order_type || 'market',
        }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to execute trade');
      }
      return response.json();
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['trades'] });
      setRetryingTradeId(null);
      setRetryQuantities({});
      showSuccess(
        `Trade executed successfully for ${variables.trade.symbol}`,
        'Trade Retry Successful'
      );
    },
    onError: (error: Error) => {
      showError(
        error.message || 'Failed to execute trade. Please try again.',
        'Trade Execution Failed'
      );
    },
  });

  const trades: TradeAuditLog[] = data?.data?.trades || [];
  const pagination = data?.data?.pagination || {};
  const totalPages = Math.ceil((pagination.total || 0) / pageSize);

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

  const handleRetryClick = (trade: any) => {
    setRetryingTradeId(trade.id);
    setRetryQuantities({
      ...retryQuantities,
      [trade.id]: trade.client_qty?.toString() || trade.master_qty.toString(),
    });
  };

  const handleCancelRetry = (tradeId: number) => {
    setRetryingTradeId(null);
    const newQuantities = { ...retryQuantities };
    delete newQuantities[tradeId];
    setRetryQuantities(newQuantities);
  };

  // Close all positions mutation
  const closeAllMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/trades/close-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || error.message || 'Failed to close all positions');
      }
      return response.json();
    },
    onSuccess: (data) => {
      setIsClosingAll(false);
      queryClient.invalidateQueries({ queryKey: ['trades'] });
      queryClient.invalidateQueries({ queryKey: ['account-balances'] });
      showSuccess(
        data.message || `Successfully closed ${data.data?.closed || 0} position(s)`,
        'Close All Positions'
      );
    },
    onError: (error: Error) => {
      setIsClosingAll(false);
      showError(
        error.message || 'Failed to close all positions. Please try again.',
        'Close All Failed'
      );
    },
  });

  const handleCloseAll = async () => {
    if (!confirm('Are you sure you want to close all open positions for all client accounts? This action cannot be undone.')) {
      return;
    }
    setIsClosingAll(true);
    closeAllMutation.mutate();
  };

  const handleExecuteRetry = (trade: any) => {
    retryTradeMutation.mutate({ trade, qty: parseFloat(retryQuantities[trade.id] || '0') });
  };

  const calculatePNL = (trade: any): number | null => {
    // Calculate PNL based on price difference between master and client
    // This measures replication quality, not actual trading PnL
    // PNL = (master_price - client_avg_price) * client_qty
    // Positive PNL means client got a better price (paid less for buy, received more for sell)
    // Negative PNL means client got a worse price
    // Note: For accurate realized PnL, see the trade detail dialog which fetches from Alpaca
    
    if (!trade.client_avg_price || !trade.master_price || !trade.client_qty) {
      return null;
    }

    const priceDiff = trade.master_price - trade.client_avg_price;
    const pnl = priceDiff * trade.client_qty;
    
    // For SELL orders, flip the sign (selling at higher price is better)
    if (trade.side.toLowerCase() === 'sell') {
      return -pnl;
    }
    
    return pnl;
  };

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        title="Trade History"
        description="Complete audit log of all trade replications"
      />

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <Card>
          <CardHeader>
            <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
              <CardTitle>
                All Trades ({pagination.total || 0})
              </CardTitle>
              <div className="flex gap-2 items-center w-full md:w-auto">
                {/* Close All Button */}
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

                {/* Status Filter */}
                <Select value={statusFilter} onValueChange={(value) => handleFilterChange('status', value)}>
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
                    onChange={(e) => handleFilterChange('symbol', e.target.value)}
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
                      <TableHead>Price</TableHead>
                      <TableHead>PNL</TableHead>
                      <TableHead>Client ID</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Latency</TableHead>
                      <TableHead>Details</TableHead>
                      <TableHead>Actions</TableHead>
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
                        <Fragment key={trade.id}>
                          <TableRow 
                            className="cursor-pointer hover:bg-muted/50"
                            onClick={(e) => {
                              // Don't open dialog if clicking on buttons or inputs
                              const target = e.target as HTMLElement;
                              if (target.closest('button') || target.closest('input')) {
                                return;
                              }
                              setSelectedTrade(trade);
                              setIsDetailDialogOpen(true);
                            }}
                          >
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
                            <TableCell className="text-xs">
                              {trade.client_avg_price ? (
                                <div>
                                  <div className="font-semibold">${trade.client_avg_price.toFixed(2)}</div>
                                  {trade.master_price && (
                                    <div className="text-muted-foreground text-xs">
                                      Master: ${trade.master_price.toFixed(2)}
                                    </div>
                                  )}
                                </div>
                              ) : trade.master_price ? (
                                <div className="text-muted-foreground">${trade.master_price.toFixed(2)}</div>
                              ) : (
                                '-'
                              )}
                            </TableCell>
                            <TableCell>
                              {(() => {
                                const pnl = calculatePNL(trade);
                                if (pnl === null) {
                                  return <span className="text-muted-foreground">-</span>;
                                }
                                const isPositive = pnl >= 0;
                                return (
                                  <span
                                    className={`font-semibold ${
                                      isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                                    }`}
                                  >
                                    {isPositive ? '+' : ''}{formatCurrency(pnl)}
                                  </span>
                                );
                              })()}
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
                            <TableCell>
                              {trade.status === 'failed' && (
                                <>
                                  {retryingTradeId !== trade.id && (
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => handleRetryClick(trade)}
                                      className="h-8 text-xs"
                                    >
                                      <RotateCcw className="h-3 w-3 mr-1" />
                                      Retry
                                    </Button>
                                  )}
                                </>
                              )}
                            </TableCell>
                          </TableRow>
                          {retryingTradeId === trade.id && trade.status === 'failed' && (
                            <TableRow>
                              <TableCell colSpan={10} className="bg-muted/50 p-4">
                                <div className="flex items-center gap-4 flex-wrap">
                                  <div className="text-sm font-medium">Edit Quantity:</div>
                                  <Input
                                    type="number"
                                    step="0.0001"
                                    value={retryQuantities[trade.id] || ''}
                                    onChange={(e) =>
                                      setRetryQuantities({
                                        ...retryQuantities,
                                        [trade.id]: e.target.value,
                                      })
                                    }
                                    className="w-32"
                                    placeholder="Quantity"
                                  />
                                  <div className="text-sm text-muted-foreground">
                                    Symbol: <span className="font-semibold">{trade.symbol}</span> | 
                                    Side: <span className="font-semibold">{trade.side.toUpperCase()}</span> | 
                                    Original Qty: <span className="font-semibold">{trade.client_qty || trade.master_qty}</span>
                                  </div>
                                  <div className="flex gap-2 ml-auto">
                                    <Button
                                      size="sm"
                                      onClick={() => handleExecuteRetry(trade)}
                                      disabled={retryTradeMutation.isPending || !retryQuantities[trade.id]}
                                    >
                                      {retryTradeMutation.isPending ? (
                                        <>
                                          <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                                          Executing...
                                        </>
                                      ) : (
                                        <>
                                          <Check className="h-4 w-4 mr-2" />
                                          Execute Trade
                                        </>
                                      )}
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      onClick={() => handleCancelRetry(trade.id)}
                                      disabled={retryTradeMutation.isPending}
                                    >
                                      <X className="h-4 w-4 mr-2" />
                                      Cancel
                                    </Button>
                                  </div>
                                </div>
                          </TableCell>
                        </TableRow>
                          )}
                        </Fragment>
                      );
                    })}
                  </TableBody>
                </Table>

                {/* Pagination Controls */}
                <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
                  {/* Page Size Selector */}
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Rows per page:</span>
                    <Select
                      value={pageSize.toString()}
                      onValueChange={(value) => {
                        setPageSize(parseInt(value));
                        setPage(1);
                      }}
                    >
                      <SelectTrigger className="w-[70px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="10">10</SelectItem>
                        <SelectItem value="25">25</SelectItem>
                        <SelectItem value="50">50</SelectItem>
                        <SelectItem value="100">100</SelectItem>
                        <SelectItem value="200">200</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Pagination Info */}
                  <div className="text-sm text-muted-foreground">
                    Showing {pagination.offset + 1}-{Math.min(pagination.offset + pageSize, pagination.total)} of{' '}
                    {pagination.total} trades
                  </div>

                  {/* Pagination Buttons */}
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(page - 1)}
                      disabled={page === 1 || isLoading}
                    >
                      <ChevronLeft className="h-4 w-4 mr-1" />
                      Previous
                    </Button>
                    
                    {/* Page Numbers */}
                    <div className="flex items-center gap-1">
                      {page > 2 && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPage(1)}
                            className="w-9 h-9 p-0"
                          >
                            1
                          </Button>
                          {page > 3 && <span className="text-muted-foreground">...</span>}
                        </>
                      )}
                      
                      {page > 1 && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setPage(page - 1)}
                          className="w-9 h-9 p-0"
                        >
                          {page - 1}
                        </Button>
                      )}
                      
                      <Button
                        variant="default"
                        size="sm"
                        className="w-9 h-9 p-0"
                      >
                        {page}
                      </Button>
                      
                      {page < totalPages && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setPage(page + 1)}
                          className="w-9 h-9 p-0"
                        >
                          {page + 1}
                        </Button>
                      )}
                      
                      {page < totalPages - 1 && (
                        <>
                          {page < totalPages - 2 && <span className="text-muted-foreground">...</span>}
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setPage(totalPages)}
                            className="w-9 h-9 p-0"
                          >
                            {totalPages}
                          </Button>
                        </>
                      )}
                    </div>

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage(page + 1)}
                      disabled={page >= totalPages || isLoading}
                    >
                      Next
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      {/* Trade Detail Dialog */}
      {selectedTrade && (
        <TradeDetailDialog
          trade={selectedTrade}
          open={isDetailDialogOpen}
          onOpenChange={setIsDetailDialogOpen}
        />
      )}
    </div>
  );
}

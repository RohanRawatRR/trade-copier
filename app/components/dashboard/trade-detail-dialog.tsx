'use client';

// Trade Detail Dialog - Shows detailed view of a single trade

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { 
  Eye, 
  X, 
  CheckCircle2, 
  Clock, 
  TrendingUp, 
  TrendingDown,
  Send,
  Download,
  CheckCircle,
  ArrowRight
} from 'lucide-react';
import { format } from 'date-fns';
import { useToast } from '@/components/providers/toast-provider';

interface TradeDetailDialogProps {
  trade: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TradeDetailDialog({ trade, open, onOpenChange }: TradeDetailDialogProps) {
  if (!trade) return null;

  const { showError } = useToast();

  // Fetch trade details from Alpaca API when dialog opens and trade is successful
  const { data: alpacaDetails, isLoading: isLoadingDetails, error: detailsError } = useQuery({
    queryKey: ['trade-details', trade.id],
    queryFn: async () => {
      if (trade.status !== 'success' || !trade.client_order_id) {
        return null;
      }
      const response = await fetch(`/api/trades/${trade.id}/details`);
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ 
          error: 'Failed to fetch trade details',
          message: response.statusText 
        }));
        throw new Error(errorData.error || errorData.message || 'Failed to fetch trade details from Alpaca');
      }
      const result = await response.json();
      if (!result.success) {
        throw new Error(result.error || result.message || 'Failed to fetch trade details');
      }
      return result.data;
    },
    enabled: open && trade.status === 'success' && !!trade.client_order_id,
    staleTime: 30000, // Cache for 30 seconds
    retry: false, // Don't retry on error to avoid spamming errors
  });

  // Fetch realized PnL from Alpaca fills when dialog opens (only for successful trades)
  const { data: pnlData, isLoading: isLoadingPnL } = useQuery({
    queryKey: ['trade-pnl', trade.id],
    queryFn: async () => {
      if (trade.status !== 'success' || !trade.client_order_id) {
        return null;
      }
      const response = await fetch(`/api/trades/${trade.id}/pnl`);
      if (!response.ok) {
        return null; // Silently fail - we'll use fallback calculation
      }
      const result = await response.json();
      if (result.success && result.data?.pnl !== null) {
        return result.data;
      }
      return null;
    },
    enabled: open && trade.status === 'success' && !!trade.client_order_id,
    staleTime: 60000, // Cache for 1 minute (PnL doesn't change for closed trades)
    retry: false,
  });

  // Show error toast when API call fails
  useEffect(() => {
    if (detailsError) {
      const errorMessage = detailsError instanceof Error 
        ? detailsError.message 
        : 'Failed to fetch trade details from Alpaca API';
      showError(errorMessage, 'Trade Details Error');
    }
  }, [detailsError, showError]);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  };

  const calculatePNL = () => {
    // Priority 1: Use realized PnL from Alpaca fills (FIFO-based, most accurate for sold quantity)
    if (pnlData?.pnl != null) {
      return pnlData.pnl;
    }
    
    // Priority 2: Use PNL from Alpaca details API if available
    if (alpacaDetails?.pnl != null) {
      return alpacaDetails.pnl;
    }
    
    // Priority 3: Use PNL from trade data if available
    if (typeof trade.pnl === 'number') {
      return trade.pnl;
    }
    
    // Priority 4: Calculate PNL based on price difference (fallback)
    // Use FIFO avgBuyPrice/avgSellPrice if available, otherwise use Alpaca details, then trade data
    const entryPrice = pnlData?.avgBuyPrice ?? alpacaDetails?.entryPrice ?? trade.client_avg_price;
    const exitPrice = pnlData?.avgSellPrice ?? alpacaDetails?.exitPrice ?? trade.master_price;
    
    // Check for null/undefined explicitly (0 is a valid value)
    if (entryPrice == null || exitPrice == null) {
      return null;
    }
    
    // Use sold qty from FIFO if available, otherwise use Alpaca filled qty, then trade data
    const qty = pnlData?.soldQty ?? alpacaDetails?.filledQty ?? trade.client_filled_qty ?? trade.client_qty;
    if (qty == null || qty === 0) {
      return null;
    }

    // Calculate P&L based on position type:
    // - LONG position (side='sell' to close): profit when exit > entry
    // - SHORT position (side='buy' to close): profit when entry > exit
    let pnl: number;
    if (trade.side.toLowerCase() === 'buy') {
      // Closing a SHORT position (bought to close)
      pnl = (Number(entryPrice) - Number(exitPrice)) * qty;
    } else {
      // Closing a LONG position (sold to close)
      pnl = (Number(exitPrice) - Number(entryPrice)) * qty;
    }
    
    return pnl;
  };

  const calculatePNLPercentage = () => {
    // Use FIFO avgBuyPrice if available (most accurate), otherwise use Alpaca details, then trade data
    const entryPrice = pnlData?.avgBuyPrice ?? alpacaDetails?.entryPrice ?? trade.client_avg_price;
    
    if (entryPrice == null) {
      return null;
    }
    const pnl = calculatePNL();
    if (pnl === null) return null;
    // Use sold qty from FIFO if available, otherwise use Alpaca filled qty, then trade data
    const filledQty = pnlData?.soldQty ?? alpacaDetails?.filledQty ?? trade.client_filled_qty ?? trade.client_qty;
    if (filledQty == null || filledQty === 0) return null;
    const costBasis = Number(entryPrice) * filledQty;
    if (costBasis === 0) return null;
    return (pnl / costBasis) * 100;
  };

  const pnl = calculatePNL();
  const pnlPercentage = calculatePNLPercentage();
  const isPositive = pnl !== null && pnl >= 0;
  const isBuy = trade.side.toLowerCase() === 'buy';

  const tradeDate = trade.replication_started_at 
    ? new Date(trade.replication_started_at)
    : null;
  
  const isValidDate = tradeDate && !isNaN(tradeDate.getTime());
  const formattedDate = isValidDate 
    ? format(tradeDate, 'MM/dd/yyyy hh:mm:ss a OOO')
    : trade.replication_started_at || 'N/A';

  const getStatusColor = () => {
    switch (trade.status) {
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0 gap-0">
        <DialogHeader className="px-5 pt-4 pb-3 border-b border-border/50">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-primary/10">
              <Eye className="h-3.5 w-3.5 text-primary" />
            </div>
            <DialogTitle className="text-lg font-semibold">Trade Details</DialogTitle>
          </div>
        </DialogHeader>

        {/* Trade Summary */}
        <div className="px-5 py-4 space-y-4">
          {/* Performance Box - Sleek design */}
          <div className={`relative rounded-xl p-5 transition-all duration-300 ${
            pnl !== null && isPositive 
              ? 'bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/20 border-2 border-green-200/50 dark:border-green-800/50 shadow-lg shadow-green-500/5' 
              : pnl !== null && !isPositive 
              ? 'bg-gradient-to-br from-red-50 to-rose-50 dark:from-red-950/30 dark:to-rose-950/20 border-2 border-red-200/50 dark:border-red-800/50 shadow-lg shadow-red-500/5' 
              : 'bg-gradient-to-br from-muted/50 to-muted/30 border-2 border-border/50 shadow-lg'
          }`}>
            {/* Top Row: Symbol (left) and Date/Time (right) */}
            <div className="flex items-start justify-between mb-4">
              <div className="flex flex-col">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mb-1 font-medium">Symbol</div>
                <div className="text-2xl font-bold text-foreground tracking-tight">{trade.symbol}</div>
              </div>
              {isValidDate && (
                <div className="text-[10px] text-muted-foreground/70 text-right font-medium">
                  {format(tradeDate, 'MM/dd/yyyy hh:mm:ss a OOO')}
                </div>
              )}
            </div>

            {/* Middle Row: PNL (left) and Percentage (right) - Only show for sell trades when PNL can be calculated */}
            {!isBuy && pnl !== null && (
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5">
                  <div className={`p-1.5 rounded-lg ${isPositive ? 'bg-green-500/10' : 'bg-red-500/10'}`}>
                    {isPositive ? (
                      <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-500" />
                    ) : (
                      <TrendingDown className="h-4 w-4 text-red-600 dark:text-red-500" />
                    )}
                  </div>
                  <span className={`text-3xl font-bold tracking-tight ${isPositive ? 'text-green-600 dark:text-green-500' : 'text-red-600 dark:text-red-500'}`}>
                    {isPositive ? '+' : ''}{formatCurrency(pnl)}
                  </span>
                </div>
                {pnlPercentage !== null && (
                  <span className={`text-lg font-bold ${isPositive ? 'text-green-600 dark:text-green-500' : 'text-red-600 dark:text-red-500'}`}>
                    {isPositive ? '+' : ''}{pnlPercentage.toFixed(2)}%
                  </span>
                )}
              </div>
            )}

            {/* Bottom Section: Entry and Exit - Only show for sell trades */}
            {!isBuy && (
              <div className="space-y-4 pt-4 border-t border-border/40">
                {/* Entry Row */}
                <div className="flex items-start justify-between">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">Entry</div>
                  <div className="flex flex-col text-right">
                    {(() => {
                      // Priority: FIFO avgBuyPrice (most accurate), then Alpaca details, then trade data
                      const entryPrice = pnlData?.avgBuyPrice ?? alpacaDetails?.entryPrice ?? trade.client_avg_price;
                      const filledQty = pnlData?.soldQty ?? alpacaDetails?.filledQty ?? trade.client_filled_qty ?? trade.client_qty;
                      
                      return entryPrice ? (
                        <>
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">
                            {formatCurrency(entryPrice)}
                          </div>
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mt-1 font-medium">
                            × {(filledQty ?? '-').toString()}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">-</div>
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mt-1 font-medium">
                            × {(filledQty ?? '-').toString()}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
                
                {/* Exit Row */}
                <div className="flex items-start justify-between">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">Exit</div>
                  <div className="flex flex-col text-right">
                    {(() => {
                      // Priority: FIFO avgSellPrice (most accurate), then Alpaca details, then trade data
                      const exitPrice = pnlData?.avgSellPrice ?? alpacaDetails?.exitPrice ?? trade.master_price;
                      const filledQty = pnlData?.soldQty ?? trade.master_qty;
                      
                      return exitPrice ? (
                        <>
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">
                            {formatCurrency(exitPrice)}
                          </div>
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mt-1 font-medium">
                            × {(filledQty ?? '-').toString()}
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">-</div>
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 mt-1 font-medium">
                            × {(filledQty ?? '-').toString()}
                          </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Trade Details Grid */}
          <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border/50">
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">Client Account</div>
              <div className="font-mono text-sm font-semibold text-foreground">{trade.client_account_id}</div>
            </div>
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">Order Type</div>
              <div className="text-sm font-semibold capitalize text-foreground">{trade.order_type || 'Market'}</div>
            </div>
            <div className="space-y-1">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">Master Order ID</div>
              <div className="font-mono text-xs text-foreground/80">{trade.master_order_id}</div>
            </div>
            {trade.client_order_id && (
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">Client Order ID</div>
                <div className="font-mono text-xs text-foreground/80">{trade.client_order_id}</div>
              </div>
            )}
            {trade.master_price && (
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">Master Price</div>
                <div className="text-sm font-semibold text-foreground">{formatCurrency(trade.master_price)}</div>
              </div>
            )}
            {trade.client_avg_price && (
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium">Client Avg Price</div>
                <div className="text-sm font-semibold text-foreground">{formatCurrency(trade.client_avg_price)}</div>
              </div>
            )}
          </div>

          {/* Trade Execution Timeline */}
          <div className="pt-4 border-t border-border/50">
            <div className="flex items-center gap-2 mb-4">
              <div className="flex items-center gap-1">
                <div className="h-2.5 w-0.5 bg-muted-foreground/30 rounded-full" />
                <div className="h-2.5 w-0.5 bg-muted-foreground/30 rounded-full" />
                <div className="h-2.5 w-0.5 bg-muted-foreground/30 rounded-full" />
              </div>
              <span className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">Trade Execution</span>
              {trade.replication_latency_ms && (
                <>
                  <span className="text-xs text-muted-foreground/70">{trade.replication_latency_ms}ms</span>
                </>
              )}
            </div>

            <div className="space-y-3 pl-6 relative">
              {/* Vertical line */}
              <div className="absolute left-[11px] top-0 bottom-0 w-[1.5px] bg-gradient-to-b from-muted-foreground/20 via-muted-foreground/30 to-muted-foreground/20" />

              {/* SENT */}
              <div className="relative flex items-start gap-3">
                <div className={`relative z-10 flex items-center justify-center w-6 h-6 rounded-full shadow-sm transition-all ${
                  trade.status === 'success' 
                    ? 'bg-green-500 ring-2 ring-green-500/20' 
                    : 'bg-muted-foreground/30 ring-2 ring-muted-foreground/10'
                }`}>
                  {trade.status === 'success' ? (
                    <CheckCircle className="h-3.5 w-3.5 text-white" />
                  ) : (
                    <Send className="h-3.5 w-3.5 text-white" />
                  )}
                </div>
                <div className="flex-1 pt-0.5">
                  <div className="font-semibold text-xs text-foreground mb-0.5">SENT</div>
                  <div className="text-[11px] text-muted-foreground/80">Trade sent to client account</div>
                  {isValidDate && (
                    <div className="text-[11px] text-muted-foreground/60 mt-1">
                      {format(tradeDate, 'hh:mm:ss a OOO')}
                    </div>
                  )}
                </div>
              </div>

              {/* RECEIVE */}
              {trade.status === 'success' && (
                <div className="relative flex items-start gap-3">
                  <div className="relative z-10 flex items-center justify-center w-6 h-6 rounded-full bg-green-500 ring-2 ring-green-500/20 shadow-sm">
                    <Download className="h-3.5 w-3.5 text-white" />
                  </div>
                  <div className="flex-1 pt-0.5">
                    <div className="font-semibold text-xs text-foreground mb-0.5">RECEIVE</div>
                    <div className="text-[11px] text-muted-foreground/80">Trade received by Alpaca</div>
                    {isValidDate && (
                      <div className="text-[11px] text-muted-foreground/60 mt-1">
                        {format(tradeDate, 'hh:mm:ss a OOO')} • {trade.replication_latency_ms ? `${Math.round(trade.replication_latency_ms * 0.1)}ms` : '0ms'}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* APPROVE */}
              {trade.status === 'success' && (
                <div className="relative flex items-start gap-3">
                  <div className="relative z-10 flex items-center justify-center w-6 h-6 rounded-full bg-green-500 ring-2 ring-green-500/20 shadow-sm">
                    <CheckCircle className="h-3.5 w-3.5 text-white" />
                  </div>
                  <div className="flex-1 pt-0.5">
                    <div className="font-semibold text-xs text-foreground mb-0.5">APPROVE</div>
                    <div className="text-[11px] text-muted-foreground/80">Trade auto approved</div>
                    {isValidDate && (
                      <div className="text-[11px] text-muted-foreground/60 mt-1">
                        {format(tradeDate, 'hh:mm:ss a OOO')} • {trade.replication_latency_ms ? `${trade.replication_latency_ms}ms` : '0ms'}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* EXECUTE */}
              {trade.status === 'success' && (
                <div className="relative flex items-start gap-3">
                  <div className="relative z-10 flex items-center justify-center w-6 h-6 rounded-full bg-green-500 ring-2 ring-green-500/20 shadow-sm">
                    <ArrowRight className="h-3.5 w-3.5 text-white" />
                  </div>
                  <div className="flex-1 pt-0.5">
                    <div className="font-semibold text-xs text-foreground mb-0.5">
                      {isBuy ? 'OPEN POSITION' : 'EXIT POSITION'}
                    </div>
                    <div className="text-[11px] text-muted-foreground/80">
                      {isBuy ? 'Open' : 'Exit'} {trade.side.toLowerCase()} {trade.symbol} position
                    </div>
                    {isValidDate && (
                      <div className="text-[11px] text-muted-foreground/60 mt-1">
                        {format(tradeDate, 'hh:mm:ss a OOO')} • {trade.replication_latency_ms ? `${Math.round(trade.replication_latency_ms * 0.1)}ms` : '0ms'}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* FAILED */}
              {trade.status === 'failed' && (
                <div className="relative flex items-start gap-3">
                  <div className="relative z-10 flex items-center justify-center w-6 h-6 rounded-full bg-red-500 ring-2 ring-red-500/20 shadow-sm">
                    <X className="h-3.5 w-3.5 text-white" />
                  </div>
                  <div className="flex-1 pt-0.5">
                    <div className="font-semibold text-xs text-red-600 dark:text-red-500 mb-0.5">FAILED</div>
                    {trade.error_message && (
                      <div className="text-[11px] text-red-500/80 dark:text-red-400/80 mt-1">{trade.error_message}</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

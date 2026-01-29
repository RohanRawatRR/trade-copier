// API Route: /api/accounts/equity-history
// Fetch historical equity data from Alpaca Portfolio History API

import { NextRequest, NextResponse } from 'next/server';
import { LRUCache } from 'lru-cache';
import prisma from '@/lib/prisma';
import { AlpacaClient } from '@/lib/alpaca';
import { decryptApiKey } from '@/lib/encryption';

// LRU cache for portfolio history results with TTL and size limits
// Prevents indefinite memory growth by automatically evicting least recently used entries
// Key: `${accountId}_${days}`, Value: portfolio history data
const historyCache = new LRUCache<string, any>({
  max: 500, // Maximum number of entries (adjust based on expected account count)
  ttl: 10 * 60 * 1000, // 10 minutes TTL
  updateAgeOnGet: true, // Reset TTL on access (keeps frequently used entries fresh)
  updateAgeOnHas: false, // Don't reset TTL on has() checks
});

/**
 * Get cached portfolio history or null if expired/missing
 */
const getCachedHistory = (cacheKey: string): any | null => {
  return historyCache.get(cacheKey) || null;
};

/**
 * Store portfolio history in cache
 */
const setCachedHistory = (cacheKey: string, data: any): void => {
  historyCache.set(cacheKey, data);
};

/**
 * GET /api/accounts/equity-history
 * Fetch historical equity data from Alpaca for accounts
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const accountIds = searchParams.get('account_ids')?.split(',').filter(Boolean) || [];
    const days = parseInt(searchParams.get('days') || '30', 10);
    
    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    // Map time period to Alpaca period format
    const getAlpacaPeriod = (days: number): '1D' | '1W' | '1M' | '3M' | '1A' => {
      if (days <= 1) return '1D';
      if (days <= 7) return '1W';
      if (days <= 30) return '1M';
      if (days <= 90) return '3M';
      return '1A'; // For 365 days, use 1A period
    };

    const period = getAlpacaPeriod(days);
    
    // Fetch all active clients
    let clients: any[] = [];
    try {
      clients = await prisma.clientAccount.findMany({
        where: { is_active: true },
        select: {
          account_id: true,
          account_name: true,
          encrypted_api_key: true,
          encrypted_secret_key: true,
        },
      });
    } catch (dbError: any) {
      console.warn('Error fetching clients:', dbError.message);
      clients = [];
    }

    // Fetch master account
    let masterAccount: any = null;
    try {
      masterAccount = await (prisma as any).masterAccount.findFirst({
        where: { is_active: true },
        select: {
          account_id: true,
          encrypted_api_key: true,
          encrypted_secret_key: true,
        },
      });
    } catch (dbError: any) {
      console.warn('Error fetching master account:', dbError.message);
    }

    const portfolioHistories: Record<string, any> = {};
    const growthData: Record<string, { 
      current: number; 
      previous: number; 
      growth: number; 
      growthPercent: number 
    }> = {};

    /**
     * Calculate true trading PnL excluding deposits/withdrawals
     * 
     * Key constraints:
     * - profit_loss values are cumulative vs base_value, NOT daily deltas (do NOT sum them)
     * - Cashflows (JNLC, etc.) are used ONLY to detect if base_value changed, NOT to compute PnL
     * - Fees appear in FEE and are included in profit_loss (already accounted for)
     * - Ignore zero-equity periods before first funding event
     * - Use base_value for growth percentage calculation
     * - Support multiple deposit types (sum all non-FEE types)
     * 
     * @param history - Alpaca portfolio history response
     * @returns Trading PnL calculation result with base_value
     */
    const calculateTradingPnL = (history: any): { 
      tradingPnL: number; 
      firstNonZeroEquity: number; 
      endingEquity: number;
      baseValue: number;
    } => {
      // Robust handling: ensure arrays exist and have data
      const equity = history?.equity || [];
      const profitLoss = history?.profit_loss || [];
      const cashflow = history?.cashflow || [];
      const baseValue = history?.base_value || history?.baseValue || 0;
      
      if (equity.length === 0) {
        return { tradingPnL: 0, firstNonZeroEquity: 0, endingEquity: 0, baseValue: 0 };
      }

      // Find first non-zero equity value (ignore zero periods before first funding)
      // This handles the case where account starts at $0 before any deposits
      let firstNonZeroIndex = -1;
      let firstNonZeroEquity = 0;
      for (let i = 0; i < equity.length; i++) {
        if (equity[i] != null && equity[i] > 0) {
          firstNonZeroIndex = i;
          firstNonZeroEquity = equity[i];
          break;
        }
      }

      // If no non-zero equity found, return zero
      if (firstNonZeroIndex === -1) {
        return { tradingPnL: 0, firstNonZeroEquity: 0, endingEquity: equity[equity.length - 1] || 0, baseValue: 0 };
      }

      const endingEquity = equity[equity.length - 1] || 0;

      // Explicitly check for cashflows (JNLC and other deposit types) to detect base_value changes
      // Support multiple deposit types: sum all non-FEE types
      // Cashflows can be:
      // - Array of numbers (legacy format)
      // - Array of objects with type/amount (newer format with JNLC, etc.)
      // - Object with keys like 'JNLC', 'FEE', 'DEP', 'WDL', etc.
      let hasBaseValueChange = false;
      let totalDeposits = 0; // Sum of all non-FEE cashflow types
      
      if (Array.isArray(cashflow) && cashflow.length > 0) {
        // Check if cashflow array contains any non-zero values (indicates base_value change)
        hasBaseValueChange = cashflow.some((cf: any) => {
          if (typeof cf === 'number') {
            const val = cf || 0;
            if (val > 0) totalDeposits += val;
            return val !== 0;
          } else if (cf && typeof cf === 'object') {
            // Handle object format: { type: 'JNLC', amount: 1000 } or similar
            const amount = cf.amount || cf.value || 0;
            const type = (cf.type || '').toUpperCase();
            // Sum non-FEE types
            if (type !== 'FEE' && amount > 0) {
              totalDeposits += amount;
            }
            return amount !== 0;
          }
          return false;
        });
      } else if (cashflow && typeof cashflow === 'object' && !Array.isArray(cashflow)) {
        // Handle object format: { JNLC: [1000, 500], FEE: [-10, -5], DEP: [2000] } or similar
        // Support multiple deposit types: JNLC, DEP, WDL, etc. (any non-FEE type)
        Object.keys(cashflow).forEach((key) => {
          const upperKey = key.toUpperCase();
          // FEE is not a base_value change, skip it
          if (upperKey === 'FEE') return;
          
          const value = cashflow[key];
          if (Array.isArray(value)) {
            // Sum all positive values in the array (deposits)
            const sum = value.reduce((acc: number, val: any) => {
              const numVal = val || 0;
              return acc + (numVal > 0 ? numVal : 0);
            }, 0);
            if (sum > 0) {
              totalDeposits += sum;
              hasBaseValueChange = true;
            }
          } else if (typeof value === 'number') {
            const numVal = value || 0;
            if (numVal > 0) {
              totalDeposits += numVal;
              hasBaseValueChange = true;
            }
          }
        });
      }

      // Calculate trading PnL using profit_loss (which is already calculated correctly vs base_value)
      // profit_loss is cumulative vs base_value, so the last value represents total trading PnL
      // DO NOT sum profit_loss values - that would cause double counting
      // Cashflows are only used to detect base_value changes, not to compute PnL
      let tradingPnL = 0;
      
      if (Array.isArray(profitLoss) && profitLoss.length > 0) {
        const lastProfitLoss = profitLoss[profitLoss.length - 1];
        // Use last profit_loss value (it's cumulative from base_value, not a delta)
        // This is the total trading PnL for the period, regardless of base_value changes
        // profit_loss already accounts for the changing base_value correctly
        tradingPnL = lastProfitLoss != null ? lastProfitLoss : 0;
      } else {
        // Fallback: if profit_loss not available, use equity difference
        // This is less accurate but handles edge cases
        // Note: This doesn't account for base_value changes, so it's a last resort
        tradingPnL = endingEquity - firstNonZeroEquity;
      }

      // Use base_value for growth percentage calculation
      // If base_value is not provided, fall back to firstNonZeroEquity
      const effectiveBaseValue = baseValue > 0 ? baseValue : firstNonZeroEquity;

      return { tradingPnL, firstNonZeroEquity, endingEquity, baseValue: effectiveBaseValue };
    };

    // Fetch master account portfolio history
    if (masterAccount && (!accountIds.length || accountIds.includes('master'))) {
      try {
        // Check cache first
        const cacheKey = `master_${days}`;
        let history = getCachedHistory(cacheKey);
        
        if (!history) {
          const masterApiKey = decryptApiKey(masterAccount.encrypted_api_key);
          const masterSecretKey = decryptApiKey(masterAccount.encrypted_secret_key);

          const masterAlpacaClient = new AlpacaClient({
            apiKey: masterApiKey,
            secretKey: masterSecretKey,
            baseUrl: process.env.ALPACA_BASE_URL,
          });

          history = await masterAlpacaClient.getPortfolioHistory({
            period,
            timeframe: '1D', // Daily data
          });
          
          // Cache the result
          setCachedHistory(cacheKey, history);
        }

        // Alpaca Portfolio History API returns: 
        // { equity: number[], timestamp: number[], profit_loss: number[], profit_loss_pct: number[], cashflow: number[] }
        // Note: profit_loss is cumulative (not daily deltas), cashflow contains deposits/withdrawals
        if (history && history.equity && Array.isArray(history.equity)) {
          portfolioHistories['master'] = history.equity.map((value: number, index: number) => ({
            timestamp: history.timestamp?.[index] || Math.floor(Date.now() / 1000) - (history.equity.length - index) * 86400,
            equity: value,
          }));

          // Calculate true trading PnL using the helper function
          // This correctly handles deposits/withdrawals and uses cumulative profit_loss
          const pnlResult = calculateTradingPnL(history);
          
          if (pnlResult.baseValue > 0 || pnlResult.firstNonZeroEquity > 0) {
            // Calculate percentage from trading PnL using base_value as baseline
            // base_value is the correct starting point for growth calculation
            // Falls back to firstNonZeroEquity if base_value is not available
            const growthPercent = pnlResult.baseValue !== 0 
              ? (pnlResult.tradingPnL / pnlResult.baseValue) * 100 
              : 0;

            growthData['master'] = {
              current: pnlResult.endingEquity,
              previous: pnlResult.baseValue > 0 ? pnlResult.baseValue : pnlResult.firstNonZeroEquity,
              growth: pnlResult.tradingPnL,
              growthPercent,
            };
          }
        }
      } catch (error: any) {
        console.error('Error fetching master portfolio history:', error.message);
      }
    }

    // Fetch client account portfolio histories
    const clientPromises = clients
      .filter(client => !accountIds.length || accountIds.includes(`client_${client.account_id}`))
      .map(async (client) => {
        try {
          const accountKey = `client_${client.account_id}`;

          // Check cache first
          const cacheKey = `${accountKey}_${days}`;
          let history = getCachedHistory(cacheKey);
          
          if (!history) {
            const apiKey = decryptApiKey(client.encrypted_api_key);
            const secretKey = decryptApiKey(client.encrypted_secret_key);

            const alpacaClient = new AlpacaClient({
              apiKey,
              secretKey,
              baseUrl: process.env.ALPACA_BASE_URL,
            });

            history = await alpacaClient.getPortfolioHistory({
              period,
              timeframe: '1D', // Daily data
            });
            
            // Cache the result
            setCachedHistory(cacheKey, history);
          }

          // Alpaca Portfolio History API returns: 
          // { equity: number[], timestamp: number[], profit_loss: number[], profit_loss_pct: number[], cashflow: number[], base_value: number }
          // Note: profit_loss is cumulative (not daily deltas), cashflow contains deposits/withdrawals
          if (history && history.equity && Array.isArray(history.equity)) {
            portfolioHistories[accountKey] = history.equity.map((value: number, index: number) => ({
              timestamp: history.timestamp?.[index] || Math.floor(Date.now() / 1000) - (history.equity.length - index) * 86400,
              equity: value,
            }));

            // Calculate true trading PnL using the helper function
            // This correctly handles deposits/withdrawals and uses cumulative profit_loss
            const pnlResult = calculateTradingPnL(history);
            
            if (pnlResult.baseValue > 0 || pnlResult.firstNonZeroEquity > 0) {
              // Calculate percentage from trading PnL using base_value as baseline
              // base_value is the correct starting point for growth calculation
              // Falls back to firstNonZeroEquity if base_value is not available
              const growthPercent = pnlResult.baseValue !== 0 
                ? (pnlResult.tradingPnL / pnlResult.baseValue) * 100 
                : 0;

              growthData[accountKey] = {
                current: pnlResult.endingEquity,
                previous: pnlResult.baseValue > 0 ? pnlResult.baseValue : pnlResult.firstNonZeroEquity,
                growth: pnlResult.tradingPnL,
                growthPercent,
              };
            }
          }
        } catch (error: any) {
          console.error(`Error fetching portfolio history for ${client.account_id}:`, error.message);
        }
      });

    await Promise.all(clientPromises);

    return NextResponse.json({
      success: true,
      data: {
        histories: portfolioHistories,
        growth: growthData,
      },
    });
  } catch (error: any) {
    console.error('Error fetching equity history:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch equity history',
        message: error.message,
      },
      { status: 500 }
    );
  }
}
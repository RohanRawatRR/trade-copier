// API Route: /api/accounts/equity-history
// Fetch historical equity data from Alpaca Portfolio History API

import { NextRequest, NextResponse } from 'next/server';
import { LRUCache } from 'lru-cache';
import prisma from '@/lib/prisma';
import { AlpacaClient } from '@/lib/alpaca';
import { decryptApiKey } from '@/lib/encryption';

// LRU cache for portfolio history results
const historyCache = new LRUCache<string, any>({
  max: 500,
  ttl: 10 * 60 * 1000, // 10 minutes
  updateAgeOnGet: true,
  updateAgeOnHas: false,
});

/** Get cached portfolio history */
const getCachedHistory = (cacheKey: string): any | null => historyCache.get(cacheKey) || null;

/** Store portfolio history in cache */
const setCachedHistory = (cacheKey: string, data: any): void => historyCache.set(cacheKey, data);

/**
 * Calculate true trading PnL, excluding deposits/withdrawals
 */
const calculateTradingPnL = (history: any) => {
  const equity = history?.equity || [];
  const profitLoss = history?.profit_loss || [];
  const cashflow = history?.cashflow || [];
  const baseValue = history?.base_value || history?.baseValue || 0;

  if (equity.length === 0) {
    return { tradingPnL: 0, firstNonZeroEquity: 0, endingEquity: 0, baseValue: 0 };
  }

  // Find first non-zero equity (ignore pre-funding periods)
  let firstNonZeroEquity = 0;
  let firstNonZeroIndex = -1;
  for (let i = 0; i < equity.length; i++) {
    if (equity[i] != null && equity[i] > 0) {
      firstNonZeroEquity = equity[i];
      firstNonZeroIndex = i;
      break;
    }
  }

  if (firstNonZeroIndex === -1) {
    return { tradingPnL: 0, firstNonZeroEquity: 0, endingEquity: equity[equity.length - 1] || 0, baseValue: 0 };
  }

  const endingEquity = equity[equity.length - 1] || 0;

  // Sum all non-FEE deposits from cashflow
  let totalDeposits = 0;
  if (Array.isArray(cashflow)) {
    cashflow.forEach(cf => {
      if (typeof cf === 'number') {
        if (cf > 0) totalDeposits += cf;
      } else if (cf && typeof cf === 'object') {
        const amount = cf.amount || cf.value || 0;
        const type = (cf.type || '').toUpperCase();
        if (type !== 'FEE' && amount > 0) totalDeposits += amount;
      }
    });
  } else if (cashflow && typeof cashflow === 'object') {
    Object.keys(cashflow).forEach(key => {
      const upperKey = key.toUpperCase();
      if (upperKey === 'FEE') return;
      const val = cashflow[key];
      if (Array.isArray(val)) {
        val.forEach(v => { if (v > 0) totalDeposits += v; });
      } else if (typeof val === 'number' && val > 0) {
        totalDeposits += val;
      }
    });
  }

  // Determine effective base value
  const effectiveBaseValue = baseValue > 0 ? baseValue : firstNonZeroEquity;

  // Compute trading PnL
  const equityDelta = endingEquity - effectiveBaseValue;
  let tradingPnL = equityDelta;

  if (Array.isArray(profitLoss) && profitLoss.length > 0) {
    const lastProfitLoss = profitLoss[profitLoss.length - 1] ?? 0;
    // Use lastProfitLoss only if it accounts for >=50% of equity delta
    tradingPnL = Math.abs(lastProfitLoss) >= Math.abs(equityDelta * 0.5)
      ? lastProfitLoss
      : equityDelta;
  }

  return {
    tradingPnL,
    firstNonZeroEquity,
    endingEquity,
    baseValue: effectiveBaseValue,
    totalDeposits,
  };
};

/**
 * GET /api/accounts/equity-history
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const accountIds = searchParams.get('account_ids')?.split(',').filter(Boolean) || [];
    const days = parseInt(searchParams.get('days') || '30', 10);

    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const getAlpacaPeriod = (days: number): '1D' | '1W' | '1M' | '3M' | '1A' => {
      if (days <= 1) return '1D';
      if (days <= 7) return '1W';
      if (days <= 30) return '1M';
      if (days <= 90) return '3M';
      return '1A';
    };
    const period = getAlpacaPeriod(days);

    // Fetch clients
    const clients = await prisma.clientAccount.findMany({
      where: { is_active: true },
      select: { account_id: true, account_name: true, encrypted_api_key: true, encrypted_secret_key: true },
    });

    // Fetch master
    const masterAccount = await prisma.masterAccount.findFirst({
      where: { is_active: true },
      select: { account_id: true, encrypted_api_key: true, encrypted_secret_key: true },
    });

    const portfolioHistories: Record<string, any> = {};
    const growthData: Record<string, { current: number; previous: number; growth: number; growthPercent: number }> = {};

    // Fetch master account history
    if (masterAccount && (!accountIds.length || accountIds.includes('master'))) {
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

        history = await masterAlpacaClient.getPortfolioHistory({ period, timeframe: '1D' });
        setCachedHistory(cacheKey, history);
      }

      if (history && Array.isArray(history.equity)) {
        portfolioHistories['master'] = history.equity.map((value: number, index: number) => ({
          timestamp: history.timestamp?.[index] || Math.floor(Date.now() / 1000) - (history.equity.length - index) * 86400,
          equity: value,
        }));

        const pnlResult = calculateTradingPnL(history);
        growthData['master'] = {
          current: pnlResult.endingEquity,
          previous: pnlResult.baseValue,
          growth: pnlResult.tradingPnL,
          growthPercent: pnlResult.baseValue > 0 ? (pnlResult.tradingPnL / pnlResult.baseValue) * 100 : 0,
        };
      }
    }

    // Fetch client histories
    await Promise.all(clients
      .filter(client => !accountIds.length || accountIds.includes(`client_${client.account_id}`))
      .map(async (client) => {
        try {
          const accountKey = `client_${client.account_id}`;
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

            history = await alpacaClient.getPortfolioHistory({ period, timeframe: '1D' });
            setCachedHistory(cacheKey, history);
          }

          if (history && Array.isArray(history.equity)) {
            portfolioHistories[accountKey] = history.equity.map((value: number, index: number) => ({
              timestamp: history.timestamp?.[index] || Math.floor(Date.now() / 1000) - (history.equity.length - index) * 86400,
              equity: value,
            }));

            const pnlResult = calculateTradingPnL(history);
            growthData[accountKey] = {
              current: pnlResult.endingEquity,
              previous: pnlResult.baseValue,
              growth: pnlResult.tradingPnL,
              growthPercent: pnlResult.baseValue > 0 ? (pnlResult.tradingPnL / pnlResult.baseValue) * 100 : 0,
            };
          }
        } catch (error: any) {
          console.error(`Error fetching client ${client.account_id}:`, error.message);
        }
      })
    );

    return NextResponse.json({ success: true, data: { histories: portfolioHistories, growth: growthData } });

  } catch (error: any) {
    console.error('Error fetching equity history:', error);
    return NextResponse.json({ success: false, error: 'Failed to fetch equity history', message: error.message }, { status: 500 });
  }
}

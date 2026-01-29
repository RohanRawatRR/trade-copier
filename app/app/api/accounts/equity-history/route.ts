// API Route: /api/accounts/equity-history
// Fetch historical equity data from Alpaca Portfolio History API
// FIXED: Correct trading PnL by excluding deposits

import { NextRequest, NextResponse } from 'next/server';
import { LRUCache } from 'lru-cache';
import prisma from '@/lib/prisma';
import { AlpacaClient } from '@/lib/alpaca';
import { decryptApiKey } from '@/lib/encryption';

/* -----------------------------------
   Cache
----------------------------------- */

const historyCache = new LRUCache<string, any>({
  max: 500,
  ttl: 10 * 60 * 1000,
  updateAgeOnGet: true,
});

const getCachedHistory = (key: string) => historyCache.get(key) || null;
const setCachedHistory = (key: string, data: any) => historyCache.set(key, data);

/* -----------------------------------
   Trading PnL Calculation (FIXED)
----------------------------------- */

/**
 * Calculate true trading PnL by excluding deposits.
 * Since Alpaca portfolio history does NOT return cashflow,
 * we infer deposits from large equity jumps.
 */
const calculateTradingPnL = (history: any) => {
  const equity: number[] = history?.equity || [];

  if (!equity.length) {
    return {
      tradingPnL: 0,
      totalDeposits: 0,
      endingEquity: 0,
      baseValue: 0,
    };
  }

  let totalDeposits = 0;
  let lastEquity = 0;
  let firstDeposit = 0;

  // Threshold to detect deposits (USD)
  const DEPOSIT_THRESHOLD = 5000;

  for (let i = 0; i < equity.length; i++) {
    const current = equity[i];

    if (current <= 0) {
      lastEquity = current;
      continue;
    }

    if (lastEquity === 0 && current > 0) {
      // First funding
      totalDeposits += current;
      firstDeposit = current;
    } else {
      const delta = current - lastEquity;

      // Large positive jump = deposit
      if (delta > DEPOSIT_THRESHOLD) {
        totalDeposits += delta;
      }
    }

    lastEquity = current;
  }

  const endingEquity = equity[equity.length - 1];
  const tradingPnL = endingEquity - totalDeposits;

  return {
    tradingPnL,
    totalDeposits,
    endingEquity,
    baseValue: totalDeposits || firstDeposit,
  };
};

/* -----------------------------------
   GET Handler
----------------------------------- */

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const accountIds = searchParams.get('account_ids')?.split(',').filter(Boolean) || [];
    const days = parseInt(searchParams.get('days') || '30', 10);

    const getAlpacaPeriod = (days: number): '1D' | '1W' | '1M' | '3M' | '1A' => {
      if (days <= 1) return '1D';
      if (days <= 7) return '1W';
      if (days <= 30) return '1M';
      if (days <= 90) return '3M';
      return '1A';
    };

    const period = getAlpacaPeriod(days);

    /* -----------------------------------
       Fetch Accounts
    ----------------------------------- */

    const clients = await prisma.clientAccount.findMany({
      where: { is_active: true },
      select: {
        account_id: true,
        encrypted_api_key: true,
        encrypted_secret_key: true,
      },
    });

    const masterAccount = await (prisma as any).masterAccount.findFirst({
      where: { is_active: true },
      select: {
        account_id: true,
        encrypted_api_key: true,
        encrypted_secret_key: true,
      },
    });

    const portfolioHistories: Record<string, any[]> = {};
    const growthData: Record<
      string,
      { current: number; previous: number; growth: number; growthPercent: number }
    > = {};

    /* -----------------------------------
       Helper to fetch history
    ----------------------------------- */

    const fetchHistory = async (key: string, apiKey: string, secretKey: string) => {
      const cacheKey = `${key}_${days}`;
      let history = getCachedHistory(cacheKey);

      if (!history) {
        const client = new AlpacaClient({
          apiKey,
          secretKey,
          baseUrl: process.env.ALPACA_BASE_URL,
        });

        history = await client.getPortfolioHistory({
          period,
          timeframe: '1D',
        });

        setCachedHistory(cacheKey, history);
      }

      return history;
    };

    /* -----------------------------------
       Master Account
    ----------------------------------- */

    if (masterAccount && (!accountIds.length || accountIds.includes('master'))) {
      const apiKey = decryptApiKey(masterAccount.encrypted_api_key);
      const secretKey = decryptApiKey(masterAccount.encrypted_secret_key);

      const history = await fetchHistory('master', apiKey, secretKey);

      if (history?.equity?.length) {
        portfolioHistories.master = history.equity.map((value: number, i: number) => ({
          timestamp:
            history.timestamp?.[i] ??
            Math.floor(Date.now() / 1000) - (history.equity.length - i) * 86400,
          equity: value,
        }));

        const pnl = calculateTradingPnL(history);

        growthData.master = {
          current: pnl.endingEquity,
          previous: pnl.baseValue,
          growth: pnl.tradingPnL,
          growthPercent:
            pnl.baseValue > 0 ? (pnl.tradingPnL / pnl.baseValue) * 100 : 0,
        };
      }
    }

    /* -----------------------------------
       Client Accounts
    ----------------------------------- */

    await Promise.all(
      clients
        .filter(c => !accountIds.length || accountIds.includes(`client_${c.account_id}`))
        .map(async client => {
          try {
            const apiKey = decryptApiKey(client.encrypted_api_key);
            const secretKey = decryptApiKey(client.encrypted_secret_key);
            const key = `client_${client.account_id}`;

            const history = await fetchHistory(key, apiKey, secretKey);

            if (history?.equity?.length) {
              portfolioHistories[key] = history.equity.map((value: number, i: number) => ({
                timestamp:
                  history.timestamp?.[i] ??
                  Math.floor(Date.now() / 1000) - (history.equity.length - i) * 86400,
                equity: value,
              }));

              const pnl = calculateTradingPnL(history);

              growthData[key] = {
                current: pnl.endingEquity,
                previous: pnl.baseValue,
                growth: pnl.tradingPnL,
                growthPercent:
                  pnl.baseValue > 0 ? (pnl.tradingPnL / pnl.baseValue) * 100 : 0,
              };
            }
          } catch (err: any) {
            console.error(`Client ${client.account_id} error:`, err.message);
          }
        })
    );

    return NextResponse.json({
      success: true,
      data: {
        histories: portfolioHistories,
        growth: growthData,
      },
    });
  } catch (error: any) {
    console.error('Equity history error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch equity history' },
      { status: 500 }
    );
  }
}

// API Route: /api/accounts/equity-history
// Fetch historical equity data from Alpaca Portfolio History API

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { AlpacaClient } from '@/lib/alpaca';
import { decryptApiKey } from '@/lib/encryption';

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

    // Fetch master account portfolio history
    if (masterAccount && (!accountIds.length || accountIds.includes('master'))) {
      try {
        const masterApiKey = decryptApiKey(masterAccount.encrypted_api_key);
        const masterSecretKey = decryptApiKey(masterAccount.encrypted_secret_key);

        const masterAlpacaClient = new AlpacaClient({
          apiKey: masterApiKey,
          secretKey: masterSecretKey,
          baseUrl: process.env.ALPACA_BASE_URL,
        });

        const history = await masterAlpacaClient.getPortfolioHistory({
          period,
          timeframe: '1D', // Daily data
        });

        // Alpaca Portfolio History API returns: { equity: number[], timestamp: number[], profit_loss: number[], profit_loss_pct: number[] }
        if (history && history.equity && Array.isArray(history.equity)) {
          portfolioHistories['master'] = history.equity.map((value: number, index: number) => ({
            timestamp: history.timestamp?.[index] || Math.floor(Date.now() / 1000) - (history.equity.length - index) * 86400,
            equity: value,
          }));

          // Calculate growth using Alpaca's profit_loss and profit_loss_pct arrays
          if (history.equity.length >= 2) {
            const first = history.equity[0];
            const last = history.equity[history.equity.length - 1];
            
            // Use Alpaca's profit_loss array: sum all period P/L values to get total profit/loss
            let totalProfitLoss = 0;
            if (history.profit_loss && Array.isArray(history.profit_loss)) {
              totalProfitLoss = history.profit_loss.reduce((sum: number, pl: number) => sum + (pl || 0), 0);
            } else {
              // Fallback to equity difference if profit_loss is not available
              totalProfitLoss = last - first;
            }

            // Calculate growth percentage from profit_loss_pct or from total profit_loss
            let growthPercent = 0;
            if (history.profit_loss_pct && Array.isArray(history.profit_loss_pct) && history.profit_loss_pct.length > 0) {
              // Sum all period percentage changes (they're typically additive for daily periods)
              growthPercent = history.profit_loss_pct.reduce((sum: number, pct: number) => sum + (pct || 0), 0);
            } else if (first !== 0) {
              // Fallback: calculate percentage from total profit_loss
              growthPercent = (totalProfitLoss / first) * 100;
            }

            growthData['master'] = {
              current: last,
              previous: first,
              growth: totalProfitLoss,
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
          const apiKey = decryptApiKey(client.encrypted_api_key);
          const secretKey = decryptApiKey(client.encrypted_secret_key);

          const alpacaClient = new AlpacaClient({
            apiKey,
            secretKey,
            baseUrl: process.env.ALPACA_BASE_URL,
          });

          const history = await alpacaClient.getPortfolioHistory({
            period,
            timeframe: '1D', // Daily data
          });

          const accountKey = `client_${client.account_id}`;

          // Alpaca Portfolio History API returns: { equity: number[], timestamp: number[], profit_loss: number[], profit_loss_pct: number[] }
          if (history && history.equity && Array.isArray(history.equity)) {
            portfolioHistories[accountKey] = history.equity.map((value: number, index: number) => ({
              timestamp: history.timestamp?.[index] || Math.floor(Date.now() / 1000) - (history.equity.length - index) * 86400,
              equity: value,
            }));

            // Calculate growth using Alpaca's profit_loss and profit_loss_pct arrays
            if (history.equity.length >= 2) {
              const first = history.equity[0];
              const last = history.equity[history.equity.length - 1];
              
              // Use Alpaca's profit_loss array: sum all period P/L values to get total profit/loss
              let totalProfitLoss = 0;
              if (history.profit_loss && Array.isArray(history.profit_loss)) {
                totalProfitLoss = history.profit_loss.reduce((sum: number, pl: number) => sum + (pl || 0), 0);
              } else {
                // Fallback to equity difference if profit_loss is not available
                totalProfitLoss = last - first;
              }

              // Calculate growth percentage from profit_loss_pct or from total profit_loss
              let growthPercent = 0;
              if (history.profit_loss_pct && Array.isArray(history.profit_loss_pct) && history.profit_loss_pct.length > 0) {
                // Sum all period percentage changes (they're typically additive for daily periods)
                growthPercent = history.profit_loss_pct.reduce((sum: number, pct: number) => sum + (pct || 0), 0);
              } else if (first !== 0) {
                // Fallback: calculate percentage from total profit_loss
                growthPercent = (totalProfitLoss / first) * 100;
              }

              growthData[accountKey] = {
                current: last,
                previous: first,
                growth: totalProfitLoss,
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

// API Route: /api/trades/[id]/pnl
// Calculate realized PnL for a trade using Alpaca fills

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { AlpacaClient } from '@/lib/alpaca';
import { decryptApiKey } from '@/lib/encryption';
import { calculatePnLOnSoldQuantity } from '@/lib/trading/realizedPnl';
import { AlpacaFill } from '@/types/alpaca';

/**
 * GET /api/trades/[id]/pnl
 * Fetch fills from Alpaca and calculate realized PnL for a closed trade
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const tradeId = parseInt(id);

    // Fetch trade from database
    const trade = await prisma.tradeAuditLog.findUnique({
      where: { id: tradeId },
      select: {
        id: true,
        client_account_id: true,
        client_order_id: true,
        symbol: true,
        side: true,
        status: true,
      },
    });

    if (!trade) {
      return NextResponse.json(
        {
          success: false,
          error: 'Trade not found',
        },
        { status: 404 }
      );
    }

    // Only calculate PnL for successful trades with client_order_id
    if (trade.status !== 'success' || !trade.client_order_id) {
      return NextResponse.json({
        success: true,
        data: {
          pnl: null,
          error: 'Trade not completed or no client order ID',
        },
      });
    }

    // Fetch client account to get API credentials
    const client = await prisma.clientAccount.findUnique({
      where: { account_id: trade.client_account_id },
      select: {
        account_id: true,
        encrypted_api_key: true,
        encrypted_secret_key: true,
        is_active: true,
      },
    });

    if (!client || !client.is_active) {
      return NextResponse.json(
        {
          success: false,
          error: 'Client account not found or not active',
        },
        { status: 404 }
      );
    }

    // Decrypt API credentials
    const apiKey = decryptApiKey(client.encrypted_api_key);
    const secretKey = decryptApiKey(client.encrypted_secret_key);

    // Create Alpaca client
    const alpacaClient = new AlpacaClient({
      apiKey,
      secretKey,
      baseUrl: process.env.ALPACA_BASE_URL,
    });

    // Fetch fills for this symbol
    // We need both buy and sell fills to calculate realized PnL for a closed trade
    // Alpaca API has a max page size of 100
    const fills = await alpacaClient.getFills({
      symbol: trade.symbol,
      pageSize: 100, // Alpaca's maximum page size
    });

    // Filter fills for this specific symbol
    const symbolFills = fills.filter(
      (fill: any) => fill.symbol === trade.symbol && fill.activity_type === 'FILL'
    ) as AlpacaFill[];

    if (symbolFills.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          pnl: null,
          error: 'No fills found for this symbol',
        },
      });
    }

    // Use FIFO matching to calculate realized PnL on sold quantity only
    // This handles all fills chronologically and matches sells against buys using FIFO
    // Ignores remaining open inventory
    try {
      const pnlResult = calculatePnLOnSoldQuantity(symbolFills);
      
      return NextResponse.json({
        success: true,
        data: {
          pnl: pnlResult.realizedPnL,
          soldQty: pnlResult.soldQty,
          avgBuyPrice: pnlResult.avgBuyPrice,
          avgSellPrice: pnlResult.avgSellPrice,
          symbol: pnlResult.symbol,
        },
      });
    } catch (error: any) {
      // If calculation fails, return error
      return NextResponse.json({
        success: true,
        data: {
          pnl: null,
          error: error.message || 'Failed to calculate PnL',
        },
      });
    }
  } catch (error: any) {
    console.error('Error calculating trade PnL:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to calculate trade PnL',
        message: error.message,
      },
      { status: 500 }
    );
  }
}

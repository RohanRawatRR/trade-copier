// API Route: /api/trades/[id]/pnl
// Calculate realized PnL for a trade using Alpaca fills

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { AlpacaClient } from '@/lib/alpaca';
import { decryptApiKey } from '@/lib/encryption';
import { calculateTradePnL } from '@/lib/trading/pnl';
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

    // For a closed trade, we need to find matching buy and sell fills
    // Strategy: If this is a sell order, find the corresponding buy fills
    // If this is a buy order, find the corresponding sell fills (if position was closed)
    let relevantFills: AlpacaFill[] = [];

    if (trade.side === 'sell' && trade.client_order_id) {
      // This is a sell order - find the sell fills for this order
      const sellFills = symbolFills.filter(
        f => f.order_id === trade.client_order_id && f.side === 'sell'
      );
      
      if (sellFills.length > 0) {
        // Find corresponding buy fills (FIFO: oldest buys first)
        const totalSellQty = sellFills.reduce((sum, f) => sum + parseFloat(f.qty), 0);
        const buyFills = symbolFills
          .filter(f => f.side === 'buy')
          .sort((a, b) => new Date(a.transaction_time).getTime() - new Date(b.transaction_time).getTime());
        
        let remainingQty = totalSellQty;
        for (const buyFill of buyFills) {
          if (remainingQty <= 0) break;
          relevantFills.push(buyFill);
          remainingQty -= parseFloat(buyFill.qty);
        }
        
        relevantFills.push(...sellFills);
      }
    } else if (trade.side === 'buy' && trade.client_order_id) {
      // This is a buy order - find buy fills for this order
      const buyFills = symbolFills.filter(
        f => f.order_id === trade.client_order_id && f.side === 'buy'
      );
      
      if (buyFills.length > 0) {
        // Find corresponding sell fills (FIFO: oldest sells first, matching the buy qty)
        const totalBuyQty = buyFills.reduce((sum, f) => sum + parseFloat(f.qty), 0);
        const sellFills = symbolFills
          .filter(f => f.side === 'sell')
          .sort((a, b) => new Date(a.transaction_time).getTime() - new Date(b.transaction_time).getTime());
        
        let remainingQty = totalBuyQty;
        for (const sellFill of sellFills) {
          if (remainingQty <= 0) break;
          relevantFills.push(sellFill);
          remainingQty -= parseFloat(sellFill.qty);
        }
        
        relevantFills.push(...buyFills);
      }
    }

    // If we couldn't match fills by order_id, try using all symbol fills
    // This works if there's only one round-trip trade for this symbol
    if (relevantFills.length === 0) {
      relevantFills = symbolFills;
    }

    if (relevantFills.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          pnl: null,
          error: 'No matching fills found for this trade',
        },
      });
    }

    // Try to calculate PnL using matched fills
    // This works for closed trades where total buy qty === total sell qty
    try {
      const pnlResult = calculateTradePnL(relevantFills);
      
      return NextResponse.json({
        success: true,
        data: {
          pnl: pnlResult.realizedPnL,
          buyCost: pnlResult.buyCost,
          sellValue: pnlResult.sellValue,
          quantity: pnlResult.quantity,
          symbol: pnlResult.symbol,
        },
      });
    } catch (error: any) {
      // If trade is not closed (buy qty !== sell qty), return null
      // This is expected for open positions
      return NextResponse.json({
        success: true,
        data: {
          pnl: null,
          error: error.message || 'Trade not closed or incomplete',
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

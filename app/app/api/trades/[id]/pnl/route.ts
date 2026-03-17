// API Route: /api/trades/[id]/pnl
// Calculate realized PnL for a trade using Alpaca fills

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { AlpacaClient } from '@/lib/alpaca';
import { decryptApiKey } from '@/lib/encryption';
import { calculatePnLOnSoldQuantity, calculatePnLForClosingOrder } from '@/lib/trading/realizedPnl';
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
        replication_started_at: true,
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

    // Only calculate PnL for successful trades
    if (trade.status !== 'success') {
      return NextResponse.json({
        success: true,
        data: {
          pnl: null,
          error: 'Trade not completed',
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

    // Fetch a small window of fills for this symbol (no need for 100)
    const fills = await alpacaClient.getFills({ symbol: trade.symbol, pageSize: 25 });

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

    // If this order is a closing leg (sell_to_close or buy_to_close), compute PnL attributable to this specific order
    try {
      // Attempt to fetch order to detect position_intent and restrict PnL attribution to this order
      let orderDetails: any = null;
      try {
        if (trade.client_order_id) {
          const baseUrl = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
          const orderResp = await fetch(`${baseUrl}/v2/orders/${trade.client_order_id}`, {
            headers: {
              'APCA-API-KEY-ID': decryptApiKey(client.encrypted_api_key),
              'APCA-API-SECRET-KEY': decryptApiKey(client.encrypted_secret_key),
              'Content-Type': 'application/json',
            },
          });
          if (orderResp.ok) {
            orderDetails = await orderResp.json();
          }
        }
      } catch {}

      const intent: string | undefined = orderDetails?.position_intent;
      const isClosingOrder = intent === 'buy_to_close' || intent === 'sell_to_close' || (!intent && trade.side === 'buy');

      if (isClosingOrder && trade.client_order_id && orderDetails?.filled_avg_price && orderDetails?.filled_qty) {
        // 1) Try pairing with the previous opposite-side successful trade from our audit log (most reliable for cycles)
        if (trade.replication_started_at) {
          const prevTrade = await prisma.tradeAuditLog.findFirst({
            where: {
              client_account_id: trade.client_account_id,
              symbol: trade.symbol,
              status: 'success',
              client_order_id: { not: null },
              replication_started_at: { lt: trade.replication_started_at },
              side: trade.side === 'buy' ? 'sell' : 'buy',
            },
            orderBy: { replication_started_at: 'desc' },
            select: { client_order_id: true },
          });

          if (prevTrade?.client_order_id) {
            const baseUrl = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
            const prevResp = await fetch(`${baseUrl}/v2/orders/${prevTrade.client_order_id}`, {
              headers: {
                'APCA-API-KEY-ID': decryptApiKey(client.encrypted_api_key),
                'APCA-API-SECRET-KEY': decryptApiKey(client.encrypted_secret_key),
                'Content-Type': 'application/json',
              },
            });

            if (prevResp.ok) {
              const prevOrder = await prevResp.json();
              const prevAvg = Number(prevOrder.filled_avg_price);
              const prevQty = Number(prevOrder.filled_qty || 0);
              const curAvg = Number(orderDetails.filled_avg_price);
              const curQty = Number(orderDetails.filled_qty || 0);
              const matchedQty = Math.min(prevQty, curQty);

              if (matchedQty > 0 && isFinite(prevAvg) && isFinite(curAvg)) {
                const isShortClose = intent === 'buy_to_close' || (!intent && trade.side === 'buy');
                const entryPrice = prevAvg; // previous opposite-side trade
                const exitPrice = curAvg;   // current closing order
                const buyPrice = isShortClose ? exitPrice : entryPrice;
                const sellPrice = isShortClose ? entryPrice : exitPrice;
                const pnl = Number(((sellPrice - buyPrice) * matchedQty).toFixed(2));

                return NextResponse.json({
                  success: true,
                  data: {
                    pnl,
                    soldQty: matchedQty,
                    avgBuyPrice: Number(buyPrice.toFixed(4)),
                    avgSellPrice: Number(sellPrice.toFixed(4)),
                    symbol: trade.symbol,
                  },
                });
              }
            }
          }
        }

        // 2) Fallback: determine which prior fill we need to pair with the current closing order
        // Determine which prior fill we need to pair with the current closing order
        const neededSide = intent === 'buy_to_close' || (!intent && trade.side === 'buy') ? 'sell' : 'buy';

        // Fetch fills for this specific closing order to get its actual fill timestamps
        const orderFills = await alpacaClient.getFills({ orderId: trade.client_order_id, pageSize: 25 });
        const orderFillsSorted = orderFills
          .filter((f: any) => f.activity_type === 'FILL')
          .sort((a: any, b: any) => new Date(a.transaction_time).getTime() - new Date(b.transaction_time).getTime());

        const earliestOrderFillIso = orderFillsSorted.length
          ? orderFillsSorted[0].transaction_time
          : orderDetails.created_at;
        const earliestOrderFillTime = new Date(earliestOrderFillIso).getTime();

        // Query Alpaca directly for the prior fill before the closing order's first fill
        let priorFill: any | null = null;
        try {
          const priorUrl = `${process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets'}/v2/account/activities/FILL?symbols=${encodeURIComponent(trade.symbol)}&page_size=10&direction=desc&until=${encodeURIComponent(earliestOrderFillIso)}`;
          const priorResp = await fetch(priorUrl, {
            headers: {
              'APCA-API-KEY-ID': decryptApiKey(client.encrypted_api_key),
              'APCA-API-SECRET-KEY': decryptApiKey(client.encrypted_secret_key),
              'Content-Type': 'application/json',
            },
          });
          if (priorResp.ok) {
            const acts = await priorResp.json();
            // pick the nearest opposite-side fill strictly before the earliest order fill
            priorFill = (acts as any[])
              .filter((a: any) => a.activity_type === 'FILL' && a.side === neededSide && new Date(a.transaction_time).getTime() < earliestOrderFillTime)
              .sort((a: any, b: any) => new Date(b.transaction_time).getTime() - new Date(a.transaction_time).getTime())[0] || null;
          }
        } catch {}
        // Fallback to previously fetched fills if direct query didn't find
        if (!priorFill) {
          priorFill = symbolFills
            .filter((f: any) => f.side === neededSide && new Date(f.transaction_time).getTime() < earliestOrderFillTime)
            .sort((a: any, b: any) => new Date(b.transaction_time).getTime() - new Date(a.transaction_time).getTime())[0] || null;
        }

        if (priorFill) {
          // Use order's total filled qty and avg to compute against the previous fill
          const exitQty = Number(orderDetails.filled_qty);
          const entryQty = Number(priorFill.qty);
          const matchedQty = Math.min(exitQty, entryQty);

          const isShortClose = neededSide === 'sell';
          const entryPrice = Number(priorFill.price);
          const exitPrice = Number(orderDetails.filled_avg_price);

          // PnL = sell - buy
          const buyPrice = isShortClose ? exitPrice : entryPrice;
          const sellPrice = isShortClose ? entryPrice : exitPrice;
          const pnl = Number(((sellPrice - buyPrice) * matchedQty).toFixed(2));

          return NextResponse.json({
            success: true,
            data: {
              pnl,
              soldQty: matchedQty,
              avgBuyPrice: Number(buyPrice.toFixed(4)),
              avgSellPrice: Number(sellPrice.toFixed(4)),
              symbol: trade.symbol,
            },
          });
        }

        // If we couldn't find the immediate prior fill, fall back to per-order FIFO attribution
        const orderPnl = calculatePnLForClosingOrder(symbolFills, trade.client_order_id);
        if (!orderPnl.soldQty || orderPnl.soldQty === 0) {
          return NextResponse.json({
            success: true,
            data: {
              pnl: null,
              soldQty: 0,
              avgBuyPrice: null,
              avgSellPrice: null,
              symbol: trade.symbol,
              error: 'No matching prior fill found for this order',
            },
          });
        }
        return NextResponse.json({
          success: true,
          data: {
            pnl: orderPnl.realizedPnL,
            soldQty: orderPnl.soldQty,
            avgBuyPrice: orderPnl.avgBuyPrice,
            avgSellPrice: orderPnl.avgSellPrice,
            symbol: orderPnl.symbol,
          },
        });
      }

      // Fallback: compute realized PnL across symbol-level matched quantity
      const pnlResult = calculatePnLOnSoldQuantity(symbolFills);

      if (!pnlResult.soldQty || pnlResult.soldQty === 0) {
        return NextResponse.json({
          success: true,
          data: {
            pnl: null,
            soldQty: 0,
            avgBuyPrice: null,
            avgSellPrice: null,
            symbol: pnlResult.symbol,
            error: 'No realized PnL yet (only one side filled)'
          },
        });
      }

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

// API Route: /api/trades/[id]/details
// Fetch detailed trade information from Alpaca API

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { decryptApiKey } from '@/lib/encryption';

/**
 * GET /api/trades/[id]/details
 * Fetch order details and position information from Alpaca for a specific trade
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const tradeId = id;
    
    // Fetch trade from database
    const trade = await prisma.tradeAuditLog.findUnique({
      where: { id: parseInt(tradeId) },
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

    // Only fetch from Alpaca if trade was successful and has client_order_id
    if (trade.status !== 'success' || !trade.client_order_id) {
      return NextResponse.json({
        success: true,
        data: {
          order: null,
          position: null,
          entryPrice: null,
          exitPrice: null,
          pnl: null,
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
    const baseUrl = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';

    // Fetch order details from Alpaca
    let orderDetails = null;
    let orderError = null;
    try {
      const orderResponse = await fetch(`${baseUrl}/v2/orders/${trade.client_order_id}`, {
        headers: {
          'APCA-API-KEY-ID': apiKey,
          'APCA-API-SECRET-KEY': secretKey,
          'Content-Type': 'application/json',
        },
      });

      if (orderResponse.ok) {
        orderDetails = await orderResponse.json();
      } else {
        const errorData = await orderResponse.json().catch(() => ({ message: orderResponse.statusText }));
        orderError = errorData.message || `Failed to fetch order details (${orderResponse.status})`;
      }
    } catch (error: any) {
      console.error('Error fetching order details from Alpaca:', error);
      orderError = error.message || 'Network error while fetching order details';
    }

    // Fetch current position for the symbol (to get average cost basis)
    let positionDetails = null;
    let entryPrice: any = null;

    // Determine position intent from order details when available
    const positionIntent: string | null = orderDetails?.position_intent || null;
    const isShortClose = positionIntent === 'buy_to_close';
    const isLongClose = positionIntent === 'sell_to_close';
    const isClosing = isShortClose || isLongClose || (!positionIntent && trade.side.toLowerCase() === 'sell');

    // For closing orders, try to get position to find average cost basis
    if (isClosing) {
      try {
        // Try to get position - if it exists, use avg_entry_price
        // If position doesn't exist (closed), we'll need to calculate from activities
        const positionResponse = await fetch(`${baseUrl}/v2/positions/${trade.symbol}`, {
          headers: {
            'APCA-API-KEY-ID': apiKey,
            'APCA-API-SECRET-KEY': secretKey,
            'Content-Type': 'application/json',
          },
        });

        if (positionResponse.ok) {
          positionDetails = await positionResponse.json();
          // Average cost basis is the entry price for closing orders
          entryPrice = positionDetails.avg_entry_price || null;
        } else if (positionResponse.status === 404) {
          // Position doesn't exist (fully closed)
          // Try to get from account activities - look for previous opening fills for this symbol
          try {
            const activitiesResponse = await fetch(
              `${baseUrl}/v2/account/activities/FILL?symbols=${trade.symbol}&page_size=100`,
              {
                headers: {
                  'APCA-API-KEY-ID': apiKey,
                  'APCA-API-SECRET-KEY': secretKey,
                  'Content-Type': 'application/json',
                },
              }
            );
            
            if (activitiesResponse.ok) {
              const activities = await activitiesResponse.json();
              // For long close: look for prior BUY; for short close: prior SELL
              const neededSide = isShortClose ? 'sell' : 'buy';
              const priorActivities = activities
                .filter((activity: any) => 
                  activity.side === neededSide && 
                  activity.symbol === trade.symbol &&
                  new Date(activity.transaction_time) < new Date(orderDetails?.created_at || Date.now())
                )
                .sort((a: any, b: any) => 
                  new Date(b.transaction_time).getTime() - new Date(a.transaction_time).getTime()
                );

              if (priorActivities.length > 0) {
                entryPrice = priorActivities[0].price || null;
              }
            }
          } catch (activitiesError: any) {
            console.error('Error fetching activities:', activitiesError);
          }
        }
      } catch (error: any) {
        console.error('Error fetching position details from Alpaca:', error);
      }
    }

    // If we couldn't fetch order details and it's critical, return error
    if (!orderDetails && orderError) {
      return NextResponse.json(
        {
          success: false,
          error: 'Failed to fetch order details from Alpaca',
          message: orderError,
        },
        { status: 500 }
      );
    }

    // Calculate PNL if we have both entry and exit prices for closing orders
    let pnl = null as number | null;
    const exitPrice = orderDetails?.filled_avg_price || null;

    if (isClosing && entryPrice && exitPrice && orderDetails?.filled_qty) {
      const qty = parseFloat(orderDetails.filled_qty);

      if (isShortClose) {
        // Short cover: profit when entry (sell) > exit (buy)
        pnl = (parseFloat(entryPrice) - parseFloat(exitPrice)) * qty;
      } else if (isLongClose) {
        // Long close: profit when exit (sell) > entry (buy)
        pnl = (parseFloat(exitPrice) - parseFloat(entryPrice)) * qty;
      } else if (!positionIntent) {
        // Fallback based on side if intent missing
        if (trade.side.toLowerCase() === 'buy') {
          pnl = (parseFloat(entryPrice) - parseFloat(exitPrice)) * qty;
        } else {
          pnl = (parseFloat(exitPrice) - parseFloat(entryPrice)) * qty;
        }
      }
    }

    return NextResponse.json({
      success: true,
      data: {
        order: orderDetails,
        position: positionDetails,
        entryPrice: entryPrice ? parseFloat(entryPrice) : null,
        exitPrice: exitPrice ? parseFloat(exitPrice) : null,
        pnl,
        filledQty: orderDetails?.filled_qty ? parseFloat(orderDetails.filled_qty) : null,
      },
    });
  } catch (error: any) {
    console.error('Error fetching trade details:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch trade details',
        message: error.message,
      },
      { status: 500 }
    );
  }
}

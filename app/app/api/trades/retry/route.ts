// API Route: /api/trades/retry
// Retry/execute a failed trade

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { decryptApiKey } from '@/lib/encryption';

/**
 * POST /api/trades/retry
 * Execute a trade manually for a client account
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { 
      client_account_id, 
      symbol, 
      side, 
      qty, 
      order_type = 'market',
      price 
    } = body;

    // Validate required fields
    if (!client_account_id || !symbol || !side || !qty) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required fields: client_account_id, symbol, side, qty',
        },
        { status: 400 }
      );
    }

    // Fetch client account to get API credentials
    const client = await prisma.clientAccount.findUnique({
      where: { account_id: client_account_id },
      select: {
        account_id: true,
        encrypted_api_key: true,
        encrypted_secret_key: true,
        is_active: true,
      },
    });

    if (!client) {
      return NextResponse.json(
        {
          success: false,
          error: 'Client account not found',
        },
        { status: 404 }
      );
    }

    if (!client.is_active) {
      return NextResponse.json(
        {
          success: false,
          error: 'Client account is not active',
        },
        { status: 400 }
      );
    }

    // Decrypt API credentials
    const apiKey = decryptApiKey(client.encrypted_api_key);
    const secretKey = decryptApiKey(client.encrypted_secret_key);

    // Get base URL for Alpaca API
    const baseUrl = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';

    // Prepare order request
    const orderData: any = {
      symbol: symbol.toUpperCase(),
      qty: parseFloat(qty.toString()),
      side: side.toLowerCase(),
      type: order_type.toLowerCase(),
      time_in_force: 'day',
    };

    // Add price for limit/stop orders
    if (order_type.toLowerCase() === 'limit' && price) {
      orderData.limit_price = parseFloat(price.toString());
    } else if (order_type.toLowerCase() === 'stop' && price) {
      orderData.stop_price = parseFloat(price.toString());
    }

    // Execute order via Alpaca API
    const orderUrl = `${baseUrl}/v2/orders`;
    const orderResponse = await fetch(orderUrl, {
      method: 'POST',
      headers: {
        'APCA-API-KEY-ID': apiKey,
        'APCA-API-SECRET-KEY': secretKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(orderData),
    });

    if (!orderResponse.ok) {
      const errorData = await orderResponse.json().catch(() => ({ message: orderResponse.statusText }));
      return NextResponse.json(
        {
          success: false,
          error: errorData.message || 'Failed to execute order',
          details: errorData,
        },
        { status: orderResponse.status }
      );
    }

    const orderResult = await orderResponse.json();

    // Log the trade execution in the audit log
    try {
      const now = new Date();
      await prisma.tradeAuditLog.create({
        data: {
          master_order_id: `manual-retry-${Date.now()}`,
          client_account_id: client_account_id,
          symbol: symbol.toUpperCase(),
          side: side.toLowerCase(),
          order_type: order_type.toLowerCase(),
          master_qty: parseFloat(qty.toString()),
          client_qty: parseFloat(qty.toString()),
          status: 'success',
          retry_count: 0,
          master_trade_time: now,
          replication_started_at: now,
          replication_latency_ms: null,
        },
      });
    } catch (logError) {
      // Log error but don't fail the request
      console.error('Failed to log trade execution:', logError);
    }

    return NextResponse.json({
      success: true,
      data: {
        order: orderResult,
        message: 'Trade executed successfully',
      },
    });
  } catch (error: any) {
    console.error('Error executing trade:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to execute trade',
        message: error.message,
      },
      { status: 500 }
    );
  }
}

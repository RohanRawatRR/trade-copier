// API Route: /api/trades/close-all
// Close all open positions for all client accounts

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { decryptApiKey } from '@/lib/encryption';

/**
 * POST /api/trades/close-all
 * Close all open positions for all active client accounts
 */
export async function POST(request: NextRequest) {
  try {
    // Fetch all active client accounts
    const clients = await prisma.clientAccount.findMany({
      where: { is_active: true },
      select: {
        account_id: true,
        account_name: true,
        encrypted_api_key: true,
        encrypted_secret_key: true,
      },
    });

    if (clients.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No active client accounts found',
        data: {
          closed: 0,
          failed: 0,
          results: [],
        },
      });
    }

    const baseUrl = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
    const results: Array<{
      account_id: string;
      account_name: string | null;
      positions_closed: number;
      success: boolean;
      error?: string;
    }> = [];

    let totalClosed = 0;
    let totalFailed = 0;

    // Process each client account
    for (const client of clients) {
      try {
        // Decrypt API credentials
        const apiKey = decryptApiKey(client.encrypted_api_key);
        const secretKey = decryptApiKey(client.encrypted_secret_key);

        // Fetch all open positions for this client
        const positionsResponse = await fetch(`${baseUrl}/v2/positions`, {
          headers: {
            'APCA-API-KEY-ID': apiKey,
            'APCA-API-SECRET-KEY': secretKey,
            'Content-Type': 'application/json',
          },
        });

        if (!positionsResponse.ok) {
          const errorData = await positionsResponse.json().catch(() => ({ message: positionsResponse.statusText }));
          throw new Error(errorData.message || `Failed to fetch positions (${positionsResponse.status})`);
        }

        const positions = await positionsResponse.json();
        
        if (!Array.isArray(positions) || positions.length === 0) {
          results.push({
            account_id: client.account_id,
            account_name: client.account_name,
            positions_closed: 0,
            success: true,
          });
          continue;
        }

        // Close each position
        let closedCount = 0;
        const closeErrors: string[] = [];

        for (const position of positions) {
          try {
            const qty = Math.abs(parseFloat(position.qty));
            const side = parseFloat(position.qty) > 0 ? 'sell' : 'buy'; // If long, sell to close. If short, buy to close.

            // Create closing order
            const orderResponse = await fetch(`${baseUrl}/v2/orders`, {
              method: 'POST',
              headers: {
                'APCA-API-KEY-ID': apiKey,
                'APCA-API-SECRET-KEY': secretKey,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                symbol: position.symbol,
                qty: qty,
                side: side,
                type: 'market',
                time_in_force: 'day',
              }),
            });

            if (orderResponse.ok) {
              closedCount++;
              totalClosed++;
            } else {
              const errorData = await orderResponse.json().catch(() => ({ message: orderResponse.statusText }));
              closeErrors.push(`${position.symbol}: ${errorData.message || 'Failed to close'}`);
            }
          } catch (positionError: any) {
            closeErrors.push(`${position.symbol}: ${positionError.message || 'Unknown error'}`);
          }
        }

        results.push({
          account_id: client.account_id,
          account_name: client.account_name,
          positions_closed: closedCount,
          success: closeErrors.length === 0,
          error: closeErrors.length > 0 ? closeErrors.join('; ') : undefined,
        });

        if (closeErrors.length > 0) {
          totalFailed += closeErrors.length;
        }
      } catch (error: any) {
        totalFailed++;
        results.push({
          account_id: client.account_id,
          account_name: client.account_name,
          positions_closed: 0,
          success: false,
          error: error.message || 'Failed to process account',
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: `Closed ${totalClosed} position(s) across ${clients.length} account(s)`,
      data: {
        closed: totalClosed,
        failed: totalFailed,
        results,
      },
    });
  } catch (error: any) {
    console.error('Error closing all positions:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to close all positions',
        message: error.message,
      },
      { status: 500 }
    );
  }
}

// API Route: /api/emergency/close-all
// Emergency endpoint to cancel all open orders across all client accounts

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { AlpacaClient } from '@/lib/alpaca';

/**
 * POST /api/emergency/close-all
 * Cancel all open orders for all active client accounts
 */
export async function POST() {
  try {
    // Fetch all active clients
    const clients = await prisma.clientAccount.findMany({
      where: { is_active: true },
    });

    if (clients.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No active clients found',
        data: { cancelled: 0, failed: 0 },
      });
    }

    // Cancel orders for all clients in parallel
    const results = await Promise.allSettled(
      clients.map(async (client) => {
        try {
          // Decrypt API keys (placeholder)
          const apiKey = client.api_key; // decryptApiKey(client.api_key);
          const secretKey = client.secret_key; // decryptApiKey(client.secret_key);

          const alpacaClient = new AlpacaClient({
            apiKey,
            secretKey,
            baseUrl: process.env.ALPACA_BASE_URL,
          });

          const result = await alpacaClient.cancelAllOrders();

          return {
            account_id: client.account_id,
            account_name: client.account_name,
            status: 'success',
            orders_cancelled: Array.isArray(result) ? result.length : 0,
          };
        } catch (error: any) {
          console.error(`Error cancelling orders for ${client.account_id}:`, error);
          return {
            account_id: client.account_id,
            account_name: client.account_name,
            status: 'failed',
            error: error.message,
          };
        }
      })
    );

    // Process results
    const successfulCancellations = results.filter(
      (r) => r.status === 'fulfilled' && r.value.status === 'success'
    ).length;
    const failedCancellations = results.filter(
      (r) => r.status === 'rejected' || (r.status === 'fulfilled' && r.value.status === 'failed')
    ).length;

    const detailedResults = results.map((r) => 
      r.status === 'fulfilled' ? r.value : { status: 'error', error: 'Unknown error' }
    );

    // Log the emergency action
    await prisma.emergencyCommand.create({
      data: {
        command: 'close_all_orders',
        status: failedCancellations > 0 ? 'completed' : 'completed',
        result: JSON.stringify({
          total: clients.length,
          successful: successfulCancellations,
          failed: failedCancellations,
          details: detailedResults,
        }),
      },
    });

    return NextResponse.json({
      success: true,
      message: `Emergency cancellation completed. ${successfulCancellations} successful, ${failedCancellations} failed.`,
      data: {
        total: clients.length,
        cancelled: successfulCancellations,
        failed: failedCancellations,
        details: detailedResults,
      },
    });
  } catch (error: any) {
    console.error('Emergency close-all error:', error);

    // Log failed emergency action
    try {
      await prisma.emergencyCommand.create({
        data: {
          command: 'close_all_orders',
          status: 'failed',
          result: JSON.stringify({ error: error.message }),
        },
      });
    } catch (logError) {
      console.error('Failed to log emergency command:', logError);
    }

    return NextResponse.json(
      {
        success: false,
        error: 'Emergency cancellation failed',
        message: error.message,
      },
      { status: 500 }
    );
  }
}


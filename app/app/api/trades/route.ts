// API Route: /api/trades
// Fetch trade audit logs with filtering and pagination

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

/**
 * GET /api/trades
 * Fetch trade audit logs with optional filters
 * Query params: status, client_id, symbol, limit, offset
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    
    const status = searchParams.get('status');
    const clientId = searchParams.get('client_id');
    const symbol = searchParams.get('symbol');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    // Build filter conditions - using Prisma query builder for safety and PostgreSQL compatibility
    const where: any = {};
    if (status) where.status = status;
    if (clientId) where.client_account_id = clientId;
    if (symbol) where.symbol = symbol;

    // Fetch trades with pagination using Prisma (works with both SQLite and PostgreSQL)
    const trades = await prisma.tradeAuditLog.findMany({
      where,
      select: {
        id: true,
        master_order_id: true,
        client_account_id: true,
        symbol: true,
        side: true,
        order_type: true,
        master_qty: true,
        client_qty: true,
        status: true,
        error_message: true,
        replication_latency_ms: true,
        replication_started_at: true,
      },
      orderBy: {
        id: 'desc',
      },
      take: limit,
      skip: offset,
    });
    
    // Get total count for pagination
    const total = await prisma.tradeAuditLog.count({ where });

    return NextResponse.json({
      success: true,
      data: {
        trades: trades.map(trade => ({
          ...trade,
          replication_started_at: trade.replication_started_at.toISOString(),
        })),
        pagination: {
          total,
          limit,
          offset,
          hasMore: offset + limit < total,
        },
      },
    });
  } catch (error: any) {
    console.error('Error fetching trades:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch trades',
        message: error.message,
      },
      { status: 500 }
    );
  }
}


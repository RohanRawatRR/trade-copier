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

    // Fetch trades with pagination
    // Always use raw SQL query to avoid Prisma datetime conversion issues
    // This is more reliable when dealing with potentially corrupted datetime data
    let trades: any[] = [];
    let total = 0;
        
        // Build WHERE clause - escape values to prevent SQL injection
        const whereConditions: string[] = [];
        if (status) {
      whereConditions.push(`status = '${String(status).replace(/'/g, "''")}'`);
        }
        if (clientId) {
      whereConditions.push(`client_account_id = '${String(clientId).replace(/'/g, "''")}'`);
        }
        if (symbol) {
      whereConditions.push(`symbol = '${String(symbol).toUpperCase().replace(/'/g, "''")}'`);
        }

        const whereClause = whereConditions.length > 0 
          ? `WHERE ${whereConditions.join(' AND ')}`
          : '';

    // Use database-agnostic CAST syntax (works with both SQLite and PostgreSQL)
    // This avoids Prisma's datetime parsing which can fail with invalid data
        const query = `
          SELECT 
            id,
            master_order_id,
        client_order_id,
            client_account_id,
            symbol,
            side,
            order_type,
            master_qty,
        master_price,
            client_qty,
        client_filled_qty,
        client_avg_price,
            status,
            error_message,
            replication_latency_ms,
            CAST(replication_started_at AS TEXT) as replication_started_at
          FROM trade_audit_logs
          ${whereClause}
          ORDER BY id DESC
      LIMIT ${parseInt(String(limit))} OFFSET ${parseInt(String(offset))}
        `;

        const countQuery = `
          SELECT COUNT(*) as count
          FROM trade_audit_logs
          ${whereClause}
        `;

    try {
        const rawTrades = await prisma.$queryRawUnsafe(query) as any[];
        const totalResult = await prisma.$queryRawUnsafe(countQuery) as any[];

        total = Number(totalResult[0]?.count || 0);

        // Convert raw results to expected format
        trades = rawTrades.map((trade: any) => ({
          id: Number(trade.id),
          master_order_id: trade.master_order_id,
        client_order_id: trade.client_order_id || null,
          client_account_id: trade.client_account_id,
          symbol: trade.symbol,
          side: trade.side,
          order_type: trade.order_type,
          master_qty: Number(trade.master_qty),
        master_price: trade.master_price ? Number(trade.master_price) : null,
          client_qty: trade.client_qty ? Number(trade.client_qty) : null,
        client_filled_qty: trade.client_filled_qty ? Number(trade.client_filled_qty) : null,
        client_avg_price: trade.client_avg_price ? Number(trade.client_avg_price) : null,
          status: trade.status,
          error_message: trade.error_message,
          replication_latency_ms: trade.replication_latency_ms ? Number(trade.replication_latency_ms) : null,
          replication_started_at: trade.replication_started_at || null,
        }));
    } catch (rawQueryError: any) {
      console.error('Error fetching trades with raw SQL:', {
        message: rawQueryError.message,
        code: rawQueryError.code,
        query: query.substring(0, 200), // Log first 200 chars of query
      });
      throw rawQueryError;
    }

    return NextResponse.json({
      success: true,
      data: {
        trades,
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


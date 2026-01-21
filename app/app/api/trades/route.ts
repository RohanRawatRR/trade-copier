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
    // Use raw query to avoid datetime parsing issues with SQLite
    let trades: any[] = [];
    let total = 0;

    try {
      // Try Prisma ORM first (works well with PostgreSQL)
      trades = await prisma.tradeAuditLog.findMany({
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
      
      total = await prisma.tradeAuditLog.count({ where });

      // Format datetime fields
      trades = trades.map(trade => ({
        ...trade,
        replication_started_at: trade.replication_started_at?.toISOString() || null,
      }));
    } catch (prismaError: any) {
      // If Prisma fails due to datetime conversion issues (common with SQLite),
      // fall back to raw SQL query with datetime cast to text
      if (prismaError.code === 'P2023' || prismaError.message?.includes('Conversion failed') || prismaError.message?.includes('invalid characters')) {
        console.warn('Prisma datetime conversion error, falling back to raw SQL:', prismaError.message);
        
        // Build WHERE clause - escape values to prevent SQL injection
        const whereConditions: string[] = [];
        if (status) {
          whereConditions.push(`status = '${status.replace(/'/g, "''")}'`);
        }
        if (clientId) {
          whereConditions.push(`client_account_id = '${clientId.replace(/'/g, "''")}'`);
        }
        if (symbol) {
          whereConditions.push(`symbol = '${symbol.replace(/'/g, "''")}'`);
        }

        const whereClause = whereConditions.length > 0 
          ? `WHERE ${whereConditions.join(' AND ')}`
          : '';

        // Cast datetime to text to avoid conversion issues
        const query = `
          SELECT 
            id,
            master_order_id,
            client_account_id,
            symbol,
            side,
            order_type,
            master_qty,
            client_qty,
            status,
            error_message,
            replication_latency_ms,
            CAST(replication_started_at AS TEXT) as replication_started_at
          FROM trade_audit_logs
          ${whereClause}
          ORDER BY id DESC
          LIMIT ${limit} OFFSET ${offset}
        `;

        const countQuery = `
          SELECT COUNT(*) as count
          FROM trade_audit_logs
          ${whereClause}
        `;

        const rawTrades = await prisma.$queryRawUnsafe(query) as any[];
        const totalResult = await prisma.$queryRawUnsafe(countQuery) as any[];

        total = Number(totalResult[0]?.count || 0);

        // Convert raw results to expected format
        trades = rawTrades.map((trade: any) => ({
          id: Number(trade.id),
          master_order_id: trade.master_order_id,
          client_account_id: trade.client_account_id,
          symbol: trade.symbol,
          side: trade.side,
          order_type: trade.order_type,
          master_qty: Number(trade.master_qty),
          client_qty: trade.client_qty ? Number(trade.client_qty) : null,
          status: trade.status,
          error_message: trade.error_message,
          replication_latency_ms: trade.replication_latency_ms ? Number(trade.replication_latency_ms) : null,
          replication_started_at: trade.replication_started_at || null,
        }));
      } else {
        // Re-throw if it's a different error
        throw prismaError;
      }
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


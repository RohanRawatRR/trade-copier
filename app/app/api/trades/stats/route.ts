// API Route: /api/trades/stats
// Get aggregated trade statistics

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

/**
 * GET /api/trades/stats
 * Get trade statistics (success rate, average latency, etc.)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || 'today'; // today, week, month, all

    // Calculate date range
    let startDate: Date | undefined;
    const now = new Date();
    
    if (period === 'today') {
      startDate = new Date(now.setHours(0, 0, 0, 0));
    } else if (period === 'week') {
      startDate = new Date(now.setDate(now.getDate() - 7));
    } else if (period === 'month') {
      startDate = new Date(now.setMonth(now.getMonth() - 1));
    }

    const where = startDate ? { replication_started_at: { gte: startDate } } : {};

    // Fetch aggregated stats using Prisma aggregation (works with both SQLite and PostgreSQL)
    const [total, statusCounts, avgLatencyResult] = await Promise.all([
      prisma.tradeAuditLog.count({ where }),
      prisma.tradeAuditLog.groupBy({
        by: ['status'],
        where,
        _count: true,
      }),
      prisma.tradeAuditLog.aggregate({
        where: {
          ...where,
          replication_latency_ms: { not: null },
        },
        _avg: {
          replication_latency_ms: true,
        },
      }),
    ]);
    
    // Calculate counts by status
    const successful = statusCounts.find(s => s.status === 'success')?._count || 0;
    const failed = statusCounts.find(s => s.status === 'failed')?._count || 0;
    const skipped = statusCounts.find(s => s.status === 'skipped')?._count || 0;
    const avgLatency = avgLatencyResult._avg.replication_latency_ms || 0;

    // Calculate success rate
    const successRate = total > 0 ? (successful / total) * 100 : 0;

    return NextResponse.json({
      success: true,
      data: {
        total_trades: total,
        successful_trades: successful,
        failed_trades: failed,
        skipped_trades: skipped,
        success_rate: Math.round(successRate * 10) / 10, // Round to 1 decimal
        avg_latency_ms: Math.round(avgLatency),
        period,
      },
    });
  } catch (error: any) {
    console.error('Error fetching trade stats:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch trade statistics',
        message: error.message,
      },
      { status: 500 }
    );
  }
}


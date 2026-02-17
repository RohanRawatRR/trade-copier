// API Route: /api/clients/[id]/trade-direction
// Update trade direction filter for a client account

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

/**
 * PATCH /api/clients/[id]/trade-direction
 * Update the trade direction filter for a client account
 * 
 * Trade direction controls which trades are replicated:
 * - "both" = Replicate all trades (default)
 * - "long" = Only replicate long trades (buys to open/add, sells to close)
 * - "short" = Only replicate short trades (sells to open/add, buys to close)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { trade_direction } = body;

    // Validate trade_direction
    if (typeof trade_direction !== 'string') {
      return NextResponse.json(
        {
          success: false,
          error: 'trade_direction must be a string',
        },
        { status: 400 }
      );
    }

    // Validate allowed values
    const allowedDirections = ['both', 'long', 'short'];
    if (!allowedDirections.includes(trade_direction)) {
      return NextResponse.json(
        {
          success: false,
          error: 'trade_direction must be one of: both, long, short',
        },
        { status: 400 }
      );
    }

    // Update client account
    const updatedClient = await prisma.clientAccount.update({
      where: { account_id: id },
      data: {
        trade_direction,
        updated_at: new Date(),
      },
      select: {
        account_id: true,
        trade_direction: true,
        email: true,
        account_name: true,
      },
    });

    return NextResponse.json({
      success: true,
      data: updatedClient,
      message: `Trade direction updated to ${trade_direction}`,
    });
  } catch (error: any) {
    console.error('Error updating trade direction:', error);
    
    if (error.code === 'P2025') {
      return NextResponse.json(
        {
          success: false,
          error: 'Client account not found',
        },
        { status: 404 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update trade direction',
        message: error.message,
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/clients/[id]/trade-direction
 * Get the current trade direction filter for a client account
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const client = await prisma.clientAccount.findUnique({
      where: { account_id: id },
      select: {
        account_id: true,
        trade_direction: true,
        email: true,
        account_name: true,
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

    return NextResponse.json({
      success: true,
      data: client,
    });
  } catch (error: any) {
    console.error('Error fetching trade direction:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch trade direction',
        message: error.message,
      },
      { status: 500 }
    );
  }
}

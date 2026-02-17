// API Route: /api/clients/[id]/risk-multiplier
// Update risk multiplier for a client account

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

/**
 * PATCH /api/clients/[id]/risk-multiplier
 * Update the risk multiplier for a client account
 * 
 * Risk multiplier controls position sizing:
 * - 1.0 = Normal (100% of equity-based calculation)
 * - 0.5 = Conservative (50% of equity)
 * - 1.5 = Aggressive (150% of equity, using margin)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { risk_multiplier } = body;

    // Validate risk_multiplier
    if (typeof risk_multiplier !== 'number') {
      return NextResponse.json(
        {
          success: false,
          error: 'risk_multiplier must be a number',
        },
        { status: 400 }
      );
    }

    // Validate range (0.1x to 3.0x)
    if (risk_multiplier < 0.1 || risk_multiplier > 3.0) {
      return NextResponse.json(
        {
          success: false,
          error: 'risk_multiplier must be between 0.1 and 3.0',
        },
        { status: 400 }
      );
    }

    // Update client account
    const updatedClient = await prisma.clientAccount.update({
      where: { account_id: id },
      data: {
        risk_multiplier,
        updated_at: new Date(),
      },
      select: {
        account_id: true,
        risk_multiplier: true,
        email: true,
        account_name: true,
      },
    });

    return NextResponse.json({
      success: true,
      data: updatedClient,
      message: `Risk multiplier updated to ${risk_multiplier}x`,
    });
  } catch (error: any) {
    console.error('Error updating risk multiplier:', error);
    
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
        error: 'Failed to update risk multiplier',
        message: error.message,
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/clients/[id]/risk-multiplier
 * Get the current risk multiplier for a client account
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
        risk_multiplier: true,
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
    console.error('Error fetching risk multiplier:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch risk multiplier',
        message: error.message,
      },
      { status: 500 }
    );
  }
}

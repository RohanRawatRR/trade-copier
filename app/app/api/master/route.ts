// API Route: /api/master
// Get and update master account configuration

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { encryptApiKey } from '@/lib/encryption';

/**
 * GET /api/master
 * Get master account information
 */
export async function GET() {
  try {
    const masterAccount = await prisma.masterAccount.findFirst({
      where: { is_active: true },
      select: {
        id: true,
        account_id: true,
        is_active: true,
        created_at: true,
        updated_at: true,
        // Don't expose encrypted keys
      },
    });

    if (!masterAccount) {
      return NextResponse.json({
        success: false,
        error: 'No master account found',
      }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      data: masterAccount,
    });
  } catch (error: any) {
    console.error('Error fetching master account:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch master account',
        message: error.message,
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/master
 * Create or update master account
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { account_id, api_key, secret_key } = body;

    // Validate required fields
    if (!account_id || !api_key || !secret_key) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required fields: account_id, api_key, secret_key',
        },
        { status: 400 }
      );
    }

    // Encrypt API keys
    const encryptedApiKey = encryptApiKey(api_key);
    const encryptedSecretKey = encryptApiKey(secret_key);

    // Check if master account exists
    const existingMaster = await prisma.masterAccount.findFirst({
      where: { is_active: true },
    });

    let masterAccount;

    if (existingMaster) {
      // Deactivate old master
      await prisma.masterAccount.update({
        where: { id: existingMaster.id },
        data: { is_active: false },
      });
    }

    // Create new master account
    masterAccount = await prisma.masterAccount.create({
      data: {
        account_id,
        api_key: encryptedApiKey,
        secret_key: encryptedSecretKey,
        is_active: true,
      },
      select: {
        id: true,
        account_id: true,
        is_active: true,
        created_at: true,
        updated_at: true,
      },
    });

    return NextResponse.json({
      success: true,
      data: masterAccount,
      message: 'Master account updated successfully',
    }, { status: 201 });
  } catch (error: any) {
    console.error('Error updating master account:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update master account',
        message: error.message,
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/master
 * Delete (deactivate) master account
 */
export async function DELETE() {
  try {
    const masterAccount = await prisma.masterAccount.findFirst({
      where: { is_active: true },
    });

    if (!masterAccount) {
      return NextResponse.json({
        success: false,
        error: 'No active master account found',
      }, { status: 404 });
    }

    // Deactivate master account
    await prisma.masterAccount.update({
      where: { id: masterAccount.id },
      data: { is_active: false },
    });

    return NextResponse.json({
      success: true,
      message: 'Master account deactivated successfully',
    });
  } catch (error: any) {
    console.error('Error deleting master account:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to delete master account',
        message: error.message,
      },
      { status: 500 }
    );
  }
}


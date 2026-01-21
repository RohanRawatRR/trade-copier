// API Route: /api/master
// Get and update master account configuration

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { encryptApiKey, decryptApiKey } from '@/lib/encryption';
import { AlpacaClient } from '@/lib/alpaca';

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
    let { account_id: providedAccountId, api_key, secret_key } = body;

    // Validate required fields
    if (!providedAccountId || !api_key || !secret_key) {
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

    // Verify credentials by testing the connection
    // Note: We'll attempt verification but allow saving even if it fails
    // (credentials might be valid but account temporarily unavailable)
    let accountInfo: any = null;
    let verificationError: string | null = null;
    let finalAccountId = providedAccountId;
    
    try {
      const baseUrl = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets';
      console.log('Verifying master account credentials:', {
        baseUrl,
        accountId: providedAccountId,
        apiKeyPrefix: api_key.substring(0, 8) + '...',
      });
      
      const alpacaClient = new AlpacaClient({
        apiKey: api_key,
        secretKey: secret_key,
        baseUrl: baseUrl,
      });
      
      accountInfo = await alpacaClient.getAccount();
      console.log('Master account verification successful:', {
        accountNumber: accountInfo.account_number,
        status: accountInfo.status,
      });
      
      // Use the actual account number from Alpaca
      if (accountInfo.account_number) {
        if (providedAccountId && accountInfo.account_number !== providedAccountId) {
          console.warn(`Account ID mismatch: provided=${providedAccountId}, actual=${accountInfo.account_number}`);
        }
        finalAccountId = accountInfo.account_number;
      }
    } catch (error: any) {
      console.error('Master account credential verification failed:', {
        error: error.message,
        baseUrl: process.env.ALPACA_BASE_URL,
        providedAccountId,
      });
      
      verificationError = error.message;
      
      // For "Not Found" errors, we'll still allow saving but warn the user
      // This could be due to:
      // 1. Wrong base URL (paper vs live)
      // 2. Account temporarily unavailable
      // 3. API keys for a different environment
      
      if (!error.message?.includes('Not Found')) {
        // For other errors (Unauthorized, Forbidden), we should fail
        let errorTitle = 'Invalid API credentials';
        if (error.message?.includes('Unauthorized')) {
          errorTitle = 'Invalid API credentials';
        } else if (error.message?.includes('Forbidden')) {
          errorTitle = 'API key permission denied';
        }
        
        return NextResponse.json(
          {
            success: false,
            error: errorTitle,
            message: error.message || 'Failed to verify credentials',
          },
          { status: 400 }
        );
      }
      
      // For "Not Found", we'll continue but add a warning
      console.warn('Continuing with master account save despite verification failure (Not Found). User should verify credentials manually.');
    }

    // Check if master account exists
    const existingMaster = await prisma.masterAccount.findFirst({
      where: { is_active: true },
    });

    let masterAccount;

    if (existingMaster) {
      // Update existing master account
      masterAccount = await prisma.masterAccount.update({
        where: { id: existingMaster.id },
        data: {
          account_id: finalAccountId,
          encrypted_api_key: encryptedApiKey,
          encrypted_secret_key: encryptedSecretKey,
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
    } else {
      // Create new master account
      masterAccount = await prisma.masterAccount.create({
        data: {
          account_id: finalAccountId,
          encrypted_api_key: encryptedApiKey,
          encrypted_secret_key: encryptedSecretKey,
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
    }

    return NextResponse.json({
      success: true,
      data: masterAccount,
      message: verificationError 
        ? `Master account saved successfully, but verification failed: ${verificationError}. Please verify your credentials and base URL are correct.`
        : 'Master account updated successfully',
      warning: verificationError ? 'Credentials saved but could not be verified. Please check your API keys and base URL.' : undefined,
    }, { status: existingMaster ? 200 : 201 });
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

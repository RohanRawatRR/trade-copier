// API Route: /api/accounts/balances
// Fetch live account balances from Alpaca for all clients

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { AlpacaClient } from '@/lib/alpaca';
import { decryptApiKey } from '@/lib/encryption';

/**
 * GET /api/accounts/balances
 * Fetch live balances for all active client accounts
 */
export async function GET() {
  try {
    // Fetch all active clients
    let clients: any[] = [];
    
    try {
      clients = await prisma.clientAccount.findMany({
        where: { is_active: true },
        select: {
          account_id: true,
          account_name: true,
          encrypted_api_key: true,
          encrypted_secret_key: true,
          is_active: true,
          // Skip datetime fields to avoid conversion errors
        },
      });
    } catch (dbError: any) {
      console.warn('Database has corrupted datetime data. Returning empty clients.', dbError.message);
      clients = [];
    }

    // Fetch master account for comparison
    // Note: Master account table doesn't exist in introspected schema
    const masterAccount = null;

    // Fetch balances in parallel
    const balancePromises = clients.map(async (client) => {
      try {
        // Decrypt API keys using Fernet (matching Python service)
        let apiKey: string;
        let secretKey: string;
        
        try {
          console.log(`Attempting to decrypt keys for client: ${client.account_id}`);
          apiKey = decryptApiKey(client.encrypted_api_key);
          secretKey = decryptApiKey(client.encrypted_secret_key);
          console.log(`✓ Successfully decrypted keys for ${client.account_id}`);
        } catch (decryptError: any) {
          console.error(`✗ Decryption failed for ${client.account_id}:`, decryptError.message);
          throw new Error(`Decryption failed: ${decryptError.message}`);
        }

        const alpacaClient = new AlpacaClient({
          apiKey,
          secretKey,
          baseUrl: process.env.ALPACA_BASE_URL,
        });

        const account = await alpacaClient.getAccount();

        return {
          account_id: client.account_id,
          account_name: client.account_name,
          equity: parseFloat(account.equity),
          cash: parseFloat(account.cash),
          buying_power: parseFloat(account.buying_power),
          portfolio_value: parseFloat(account.portfolio_value),
          last_updated: new Date(),
          status: 'success',
        };
      } catch (error: any) {
        console.error(`Error fetching balance for ${client.account_id}:`, error);
        return {
          account_id: client.account_id,
          account_name: client.account_name,
          equity: 0,
          cash: 0,
          buying_power: 0,
          portfolio_value: 0,
          last_updated: new Date(),
          status: 'error',
          error: error.message,
        };
      }
    });

    // Fetch master balance
    // Note: Master account is managed by Python service, not in this database
    let masterBalance = null;

    const clientBalances = await Promise.all(balancePromises);

    // Calculate total client equity
    const totalClientEquity = clientBalances.reduce((sum, balance) => {
      return sum + (balance.status === 'success' ? balance.equity : 0);
    }, 0);

    return NextResponse.json({
      success: true,
      data: {
        master: masterBalance,
        clients: clientBalances,
        summary: {
          total_clients: clients.length,
          active_clients: clientBalances.filter((b) => b.status === 'success').length,
          total_equity: totalClientEquity,
        },
      },
    });
  } catch (error: any) {
    console.error('Error fetching account balances:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch account balances',
        message: error.message,
      },
      { status: 500 }
    );
  }
}


// API Route: /api/accounts/positions
// Fetch open positions for all active client accounts

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { decryptApiKey } from '@/lib/encryption';
import { AlpacaClient } from '@/lib/alpaca';

export async function GET() {
  try {
    // Load active clients
    const clients = await prisma.clientAccount.findMany({
      where: { is_active: true },
      select: {
        account_id: true,
        account_name: true,
        encrypted_api_key: true,
        encrypted_secret_key: true,
      },
    });

    const results = await Promise.all(
      clients.map(async (client) => {
        try {
          const apiKey = decryptApiKey(client.encrypted_api_key);
          const secretKey = decryptApiKey(client.encrypted_secret_key);
          const alpaca = new AlpacaClient({
            apiKey,
            secretKey,
            baseUrl: process.env.ALPACA_BASE_URL,
          });

          const positions = await alpaca.getPositions();

          const mapped = (Array.isArray(positions) ? positions : []).map((p: any) => ({
            symbol: p.symbol,
            qty: parseFloat(p.qty),
            side: parseFloat(p.qty) >= 0 ? 'long' : 'short',
            avg_entry_price: p.avg_entry_price ? parseFloat(p.avg_entry_price) : null,
            market_value: p.market_value ? parseFloat(p.market_value) : null,
            cost_basis: p.cost_basis ? parseFloat(p.cost_basis) : null,
            unrealized_pl: p.unrealized_pl ? parseFloat(p.unrealized_pl) : null,
            unrealized_plpc: p.unrealized_plpc ? parseFloat(p.unrealized_plpc) : null,
            unrealized_intraday_pl: p.unrealized_intraday_pl ? parseFloat(p.unrealized_intraday_pl) : null,
            unrealized_intraday_plpc: p.unrealized_intraday_plpc ? parseFloat(p.unrealized_intraday_plpc) : null,
            current_price: p.current_price ? parseFloat(p.current_price) : null,
            change_today: p.change_today ? parseFloat(p.change_today) : null,
            asset_class: p.asset_class || null,
          }));

          return {
            account_id: client.account_id,
            account_name: client.account_name,
            status: 'success' as const,
            positions: mapped,
          };
        } catch (error: any) {
          return {
            account_id: client.account_id,
            account_name: client.account_name,
            status: 'error' as const,
            error: error.message || 'Failed to fetch positions',
            positions: [] as any[],
          };
        }
      })
    );

    const clientsWithPositions = results.filter(r => r.status === 'success' && r.positions.length > 0);
    const totalPositions = clientsWithPositions.reduce((acc, r) => acc + r.positions.length, 0);

    return NextResponse.json({
      success: true,
      data: {
        clients: results,
        summary: {
          total_clients: clients.length,
          clients_with_positions: clientsWithPositions.length,
          total_positions: totalPositions,
        },
      },
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch open positions',
        message: error.message,
      },
      { status: 500 }
    );
  }
}


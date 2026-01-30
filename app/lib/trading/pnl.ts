import { AlpacaFill } from '@/types/alpaca';

export type TradePnLResult = {
  symbol: string;
  quantity: number;
  buyQty: number;
  sellQty: number;
  buyCost: number;
  sellValue: number;
  realizedPnL: number;
  residualQty: number;
};

const QTY_TOLERANCE = 0.01; // Alpaca-safe tolerance

/**
 * Calculates realized PnL for a SINGLE CLOSED TRADE
 * - Uses fill-level prices (not order prices)
 * - Handles small quantity mismatches due to floating point precision
 * - Clamps to minimum of buy/sell qty if within tolerance
 */
export function calculateTradePnL(fills: AlpacaFill[]): TradePnLResult {
  if (!fills.length) {
    throw new Error('No fills provided');
  }

  const symbol = fills[0].symbol;

  let buyQty = 0;
  let sellQty = 0;
  let buyCost = 0;
  let sellValue = 0;

  for (const fill of fills) {
    const qty = Number(fill.qty);
    const price = Number(fill.price);

    if (fill.side === 'buy') {
      buyQty += qty;
      buyCost += qty * price;
    } else if (fill.side === 'sell') {
      sellQty += qty;
      sellValue += qty * price;
    }
  }

  // Normalize floating point noise
  buyQty = Number(buyQty.toFixed(4));
  sellQty = Number(sellQty.toFixed(4));

  const residualQty = Number((buyQty - sellQty).toFixed(4));

  if (Math.abs(residualQty) > QTY_TOLERANCE) {
    throw new Error(
      `Trade not closed: buyQty=${buyQty}, sellQty=${sellQty}`
    );
  }

  // Clamp residual (treat as closed)
  const closedQty = Math.min(buyQty, sellQty);

  return {
    symbol,
    quantity: closedQty,
    buyQty,
    sellQty,
    buyCost: Number(buyCost.toFixed(2)),
    sellValue: Number(sellValue.toFixed(2)),
    realizedPnL: Number((sellValue - buyCost).toFixed(2)),
    residualQty,
  };
}

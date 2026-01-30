import { AlpacaFill } from '@/types/alpaca';

export type TradePnLResult = {
  symbol: string;
  quantity: number;
  buyCost: number;
  sellValue: number;
  realizedPnL: number;
};

/**
 * Calculates realized PnL for a SINGLE CLOSED TRADE
 * - Uses fill-level prices (not order prices)
 * - Requires total buy qty === total sell qty
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
    const qty = parseFloat(fill.qty);
    const price = parseFloat(fill.price);

    if (fill.side === 'buy') {
      buyQty += qty;
      buyCost += qty * price;
    } else if (fill.side === 'sell') {
      sellQty += qty;
      sellValue += qty * price;
    }
  }

  if (Math.abs(buyQty - sellQty) > 1e-6) {
    throw new Error(
      `Trade not closed: buyQty=${buyQty}, sellQty=${sellQty}`
    );
  }

  return {
    symbol,
    quantity: Number(buyQty.toFixed(6)),
    buyCost: Number(buyCost.toFixed(2)),
    sellValue: Number(sellValue.toFixed(2)),
    realizedPnL: Number((sellValue - buyCost).toFixed(2)),
  };
}

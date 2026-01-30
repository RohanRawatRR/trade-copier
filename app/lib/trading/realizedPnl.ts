// lib/trading/realizedPnl.ts

import { AlpacaFill } from '@/types/alpaca';

type BuyLot = {
  qty: number;
  price: number;
};

export type RealizedPnlOnSellResult = {
  symbol: string;
  soldQty: number;
  realizedPnL: number;
  avgBuyPrice: number;
  avgSellPrice: number;
};

/**
 * Calculates realized PnL ONLY on sold quantity
 * - FIFO cost basis
 * - Ignores remaining open inventory
 * - Works with fractional shares
 */
export function calculatePnLOnSoldQuantity(
  fills: AlpacaFill[]
): RealizedPnlOnSellResult {
  if (!fills.length) {
    throw new Error('No fills provided');
  }

  // Must be chronological
  const sorted = [...fills].sort(
    (a, b) =>
      new Date(a.transaction_time).getTime() -
      new Date(b.transaction_time).getTime()
  );

  const symbol = sorted[0].symbol;
  const buyLots: BuyLot[] = [];

  let soldQty = 0;
  let costBasis = 0;
  let proceeds = 0;

  for (const fill of sorted) {
    const qty = Number(fill.qty);
    const price = Number(fill.price);

    if (fill.side === 'buy') {
      buyLots.push({ qty, price });
      continue;
    }

    // SELL → consume buy lots FIFO
    let remainingSellQty = qty;

    while (remainingSellQty > 0 && buyLots.length > 0) {
      const lot = buyLots[0];
      const matchedQty = Math.min(lot.qty, remainingSellQty);

      soldQty += matchedQty;
      costBasis += matchedQty * lot.price;
      proceeds += matchedQty * price;

      lot.qty -= matchedQty;
      remainingSellQty -= matchedQty;

      if (lot.qty <= 1e-8) {
        buyLots.shift();
      }
    }
  }

  if (soldQty === 0) {
    return {
      symbol,
      soldQty: 0,
      realizedPnL: 0,
      avgBuyPrice: 0,
      avgSellPrice: 0,
    };
  }

  return {
    symbol,
    soldQty: Number(soldQty.toFixed(4)),
    realizedPnL: Number((proceeds - costBasis).toFixed(2)),
    avgBuyPrice: Number((costBasis / soldQty).toFixed(4)),
    avgSellPrice: Number((proceeds / soldQty).toFixed(4)),
  };
}

// lib/trading/fifoPnl.ts

import { AlpacaFill } from '@/types/alpaca';

type BuyLot = {
  qty: number;
  price: number;
};

export type RealizedPnLResult = {
  symbol: string;
  realizedQty: number;
  realizedPnL: number;
  avgEntry: number;
  avgExit: number;
  openQty: number;
};

export function calculateRealizedPnLFIFO(
  fills: AlpacaFill[]
): RealizedPnLResult {
  if (!fills.length) {
    throw new Error('No fills provided');
  }

  // Sort chronologically (important!)
  const sorted = [...fills].sort(
    (a, b) =>
      new Date(a.transaction_time).getTime() -
      new Date(b.transaction_time).getTime()
  );

  const symbol = sorted[0].symbol;
  const buyLots: BuyLot[] = [];

  let realizedQty = 0;
  let realizedCost = 0;
  let realizedProceeds = 0;

  for (const fill of sorted) {
    const qty = Number(fill.qty);
    const price = Number(fill.price);

    if (fill.side === 'buy') {
      buyLots.push({ qty, price });
      continue;
    }

    // SELL → match against buy lots
    let remainingSellQty = qty;

    while (remainingSellQty > 0 && buyLots.length > 0) {
      const lot = buyLots[0];
      const matchedQty = Math.min(lot.qty, remainingSellQty);

      realizedQty += matchedQty;
      realizedCost += matchedQty * lot.price;
      realizedProceeds += matchedQty * price;

      lot.qty -= matchedQty;
      remainingSellQty -= matchedQty;

      if (lot.qty <= 1e-8) {
        buyLots.shift();
      }
    }
  }

  const openQty = Number(
    buyLots.reduce((sum, lot) => sum + lot.qty, 0).toFixed(4)
  );

  const realizedPnL = realizedProceeds - realizedCost;

  return {
    symbol,
    realizedQty: Number(realizedQty.toFixed(4)),
    realizedPnL: Number(realizedPnL.toFixed(2)),
    avgEntry:
      realizedQty > 0
        ? Number((realizedCost / realizedQty).toFixed(4))
        : 0,
    avgExit:
      realizedQty > 0
        ? Number((realizedProceeds / realizedQty).toFixed(4))
        : 0,
    openQty,
  };
}

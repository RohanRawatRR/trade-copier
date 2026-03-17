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

  // Long inventory (opened by BUYS, closed by SELLS)
  const longLots: BuyLot[] = [];
  // Short inventory (opened by SELLS, closed by BUYS)
  const shortLots: BuyLot[] = [];

  let closedQty = 0;        // Total matched quantity (both closing long and covering short)
  let buyCost = 0;          // Total buy-side cost for matched qty
  let sellProceeds = 0;     // Total sell-side proceeds for matched qty

  for (const fill of sorted) {
    const qty = Number(fill.qty);
    const price = Number(fill.price);

    if (fill.side === 'sell') {
      // First, try to close existing LONG inventory
      let remainingSellQty = qty;
      while (remainingSellQty > 0 && longLots.length > 0) {
        const lot = longLots[0];
        const matchedQty = Math.min(lot.qty, remainingSellQty);

        closedQty += matchedQty;
        buyCost += matchedQty * lot.price;      // original long entry cost
        sellProceeds += matchedQty * price;     // current sell proceeds

        lot.qty -= matchedQty;
        remainingSellQty -= matchedQty;
        if (lot.qty <= 1e-8) longLots.shift();
      }

      // Any remaining SELL opens/extends SHORT inventory
      if (remainingSellQty > 1e-8) {
        shortLots.push({ qty: remainingSellQty, price });
      }
    } else {
      // BUY side
      // First, try to cover existing SHORT inventory
      let remainingBuyQty = qty;
      while (remainingBuyQty > 0 && shortLots.length > 0) {
        const lot = shortLots[0];
        const matchedQty = Math.min(lot.qty, remainingBuyQty);

        closedQty += matchedQty;
        buyCost += matchedQty * price;          // current buy-to-cover cost
        sellProceeds += matchedQty * lot.price; // original short sell proceeds

        lot.qty -= matchedQty;
        remainingBuyQty -= matchedQty;
        if (lot.qty <= 1e-8) shortLots.shift();
      }

      // Any remaining BUY opens/extends LONG inventory
      if (remainingBuyQty > 1e-8) {
        longLots.push({ qty: remainingBuyQty, price });
      }
    }
  }

  if (closedQty === 0) {
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
    soldQty: Number(closedQty.toFixed(4)),
    realizedPnL: Number((sellProceeds - buyCost).toFixed(2)),
    avgBuyPrice: Number((buyCost / closedQty).toFixed(4)),
    avgSellPrice: Number((sellProceeds / closedQty).toFixed(4)),
  };
}

/**
 * Calculates realized PnL attributable to a specific closing order (by order_id).
 * - Processes fills chronologically with FIFO matching
 * - Accumulates realized PnL only for matches executed by the provided order_id
 * - Supports both long-close (sell_to_close) and short-cover (buy_to_close)
 */
export function calculatePnLForClosingOrder(
  fills: AlpacaFill[],
  closingOrderId: string
): RealizedPnlOnSellResult {
  if (!fills.length) {
    throw new Error('No fills provided');
  }

  const sorted = [...fills].sort(
    (a, b) =>
      new Date(a.transaction_time).getTime() -
      new Date(b.transaction_time).getTime()
  );

  const symbol = sorted[0].symbol;

  const longLots: BuyLot[] = [];
  const shortLots: BuyLot[] = [];

  let closedQty = 0;
  let buyCost = 0;
  let sellProceeds = 0;

  for (const fill of sorted) {
    const qty = Number(fill.qty);
    const price = Number(fill.price);

    if (fill.side === 'sell') {
      // Close existing LONG inventory first
      let remainingSellQty = qty;
      while (remainingSellQty > 0 && longLots.length > 0) {
        const lot = longLots[0];
        const matchedQty = Math.min(lot.qty, remainingSellQty);

        // Only attribute realized PnL when this sell belongs to the closing order
        if (fill.order_id === closingOrderId) {
          closedQty += matchedQty;
          buyCost += matchedQty * lot.price;      // entry cost for long
          sellProceeds += matchedQty * price;     // proceeds from this sell
        }

        lot.qty -= matchedQty;
        remainingSellQty -= matchedQty;
        if (lot.qty <= 1e-8) longLots.shift();
      }

      // Unmatched portion extends SHORT inventory
      if (remainingSellQty > 1e-8) {
        shortLots.push({ qty: remainingSellQty, price });
      }
    } else {
      // BUY: cover SHORT inventory first
      let remainingBuyQty = qty;
      while (remainingBuyQty > 0 && shortLots.length > 0) {
        const lot = shortLots[0];
        const matchedQty = Math.min(lot.qty, remainingBuyQty);

        // Only attribute realized PnL when this buy belongs to the closing order
        if (fill.order_id === closingOrderId) {
          closedQty += matchedQty;
          buyCost += matchedQty * price;          // cost to cover
          sellProceeds += matchedQty * lot.price; // original short proceeds
        }

        lot.qty -= matchedQty;
        remainingBuyQty -= matchedQty;
        if (lot.qty <= 1e-8) shortLots.shift();
      }

      // Unmatched portion extends LONG inventory
      if (remainingBuyQty > 1e-8) {
        longLots.push({ qty: remainingBuyQty, price });
      }
    }
  }

  if (closedQty === 0) {
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
    soldQty: Number(closedQty.toFixed(4)),
    realizedPnL: Number((sellProceeds - buyCost).toFixed(2)),
    avgBuyPrice: Number((buyCost / closedQty).toFixed(4)),
    avgSellPrice: Number((sellProceeds / closedQty).toFixed(4)),
  };
}

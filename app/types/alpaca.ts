export type AlpacaFill = {
  id: string;
  activity_type: 'FILL';
  transaction_time: string;
  price: string;
  qty: string;
  side: 'buy' | 'sell';
  symbol: string;
  order_id: string;
};

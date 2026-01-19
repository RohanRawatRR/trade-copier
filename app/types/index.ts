// TypeScript Type Definitions for Trade Copier Dashboard

export interface ClientAccount {
  id: number;
  account_id: string;
  account_name?: string;
  email?: string;
  api_key: string;
  secret_key: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface MasterAccount {
  id: number;
  account_id: string;
  api_key: string;
  secret_key: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface TradeAuditLog {
  id: number;
  trade_id: string;
  master_account_id: string;
  client_account_id: string;
  symbol: string;
  side: 'buy' | 'sell';
  master_qty: number;
  client_qty?: number;
  client_notional?: number;
  status: 'success' | 'failed' | 'skipped';
  error_message?: string;
  retry_count: number;
  latency_ms?: number;
  total_platform_lag_ms?: number;
  master_equity?: number;
  client_equity?: number;
  allocation_percent?: number;
  skip_reason?: string;
  created_at: Date;
}

export interface SystemMetrics {
  id: number;
  total_trades_today: number;
  successful_trades_today: number;
  failed_trades_today: number;
  avg_latency_ms?: number;
  last_trade_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface AccountBalance {
  account_id: string;
  account_name?: string;
  equity: number;
  cash: number;
  buying_power: number;
  portfolio_value: number;
  last_updated: Date;
}

export interface TradeStats {
  total_trades: number;
  successful_trades: number;
  failed_trades: number;
  skipped_trades: number;
  success_rate: number;
  avg_latency_ms: number;
}

export interface Position {
  symbol: string;
  qty: number;
  market_value: number;
  avg_entry_price: number;
  current_price: number;
  unrealized_pl: number;
  unrealized_plpc: number;
}

export interface EmergencyCommand {
  id: number;
  command: 'close_all_orders' | 'pause_all' | 'resume_all';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: string;
  created_at: Date;
  updated_at: Date;
}

// API Response Types
export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

// Form Types
export interface AddClientForm {
  account_id: string;
  account_name?: string;
  email?: string;
  api_key: string;
  secret_key: string;
  is_active: boolean;
}

export interface UpdateMasterForm {
  account_id: string;
  api_key: string;
  secret_key: string;
}


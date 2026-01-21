"""
Scaling Engine
Calculates appropriate position sizes for client accounts based on various strategies.

Scaling Methods:
1. Equity-based: Scale by account equity ratio
2. Fixed multiplier: Fixed percentage of master trade
3. Risk-based: Based on percentage of account equity

Ensures:
- Minimum order size enforcement
- Fractional share handling
- Account buying power validation
"""
import asyncio
from typing import Dict, Optional
from decimal import Decimal, ROUND_DOWN
import structlog

from alpaca.trading.client import TradingClient

from config.settings import settings


logger = structlog.get_logger(__name__)


class ScalingEngine:
    """
    Calculate scaled position sizes for client accounts.
    
    Uses equity-based scaling:
    - client_qty = master_qty × (client_equity / master_equity)
    - Maintains proportional equity usage across all accounts
    - If master uses 90% of equity, client uses 90% of equity
    """
    
    def __init__(self, master_api_key: str, master_secret_key: str):
        self.master_api_key = master_api_key
        self.master_secret_key = master_secret_key
        self.master_client: Optional[TradingClient] = None
        self.master_equity: Optional[float] = None
        self._cache_timestamp: Optional[float] = None
        self._cache_ttl_seconds = 60  # Refresh master equity every 60s
    
    async def initialize(self):
        """Initialize master account client"""
        self.master_client = TradingClient(
            api_key=self.master_api_key,
            secret_key=self.master_secret_key,
            paper=settings.use_paper_trading
        )
        await self._refresh_master_equity()
        logger.info("scaling_engine_initialized", master_equity=self.master_equity)
    
    async def reinitialize_with_new_credentials(self, new_api_key: str, new_secret_key: str):
        """
        Reinitialize ScalingEngine with new master account credentials.
        
        Args:
            new_api_key: New master account API key
            new_secret_key: New master account secret key
        """
        logger.info("scaling_engine_reinitializing_with_new_credentials")
        
        # Update credentials
        self.master_api_key = new_api_key
        self.master_secret_key = new_secret_key
        
        # Reinitialize client
        self.master_client = TradingClient(
            api_key=self.master_api_key,
            secret_key=self.master_secret_key,
            paper=settings.use_paper_trading
        )
        
        # Clear cache to force refresh
        self._cache_timestamp = None
        self.master_equity = None
        
        # Refresh equity with new credentials
        await self._refresh_master_equity()
        
        logger.info("scaling_engine_reinitialized_with_new_credentials", master_equity=self.master_equity)
    
    async def _refresh_master_equity(self):
        """Refresh cached master account equity"""
        import time
        
        # Check if cache is still valid
        if self._cache_timestamp:
            elapsed = time.time() - self._cache_timestamp
            if elapsed < self._cache_ttl_seconds:
                return
        
        try:
            # Run in thread pool to avoid blocking
            account = await asyncio.to_thread(self.master_client.get_account)
            self.master_equity = float(account.equity)
            self._cache_timestamp = time.time()
            
            logger.debug(
                "master_equity_refreshed",
                equity=self.master_equity,
                cash=float(account.cash),
                buying_power=float(account.buying_power)
            )
        except Exception as e:
            logger.error("failed_to_refresh_master_equity", error=str(e))
            # Keep using stale cache if refresh fails
    
    async def calculate_client_quantity(
        self,
        master_qty: float,
        symbol: str,
        client_account: Dict,
        side: str = "buy",
        current_price: Optional[float] = None
    ) -> Optional[float]:
        """
        Calculate scaled quantity for a client account.
        
        Args:
            master_qty: Quantity from master trade
            symbol: Trading symbol
            client_account: Client account dict with credentials and config
            side: "buy" or "sell"
            current_price: Current price of symbol (optional, for validation)
        
        Returns:
            Scaled quantity or None if position should be skipped
        """
        try:
            # Refresh master equity if needed
            await self._refresh_master_equity()
            
            # Get client's Alpaca client
            client = TradingClient(
                api_key=client_account["api_key"],
                secret_key=client_account["secret_key"],
                paper=settings.use_paper_trading
            )
            
            # Get client account info (run in thread pool to avoid blocking)
            client_account_info = await asyncio.to_thread(client.get_account)
            client_equity = float(client_account_info.equity)
            client_buying_power = float(client_account_info.buying_power)
            
            # Check current client position
            try:
                client_pos = await asyncio.to_thread(client.get_open_position, symbol)
                client_owned_qty = float(client_pos.qty) # Positive = Long, Negative = Short
            except Exception:
                client_owned_qty = 0.0

            # Check Master's remaining position
            try:
                master_pos = await asyncio.to_thread(self.master_client.get_open_position, symbol)
                master_remaining = float(master_pos.qty)
            except Exception:
                # If get_open_position fails, it usually means position is 0
                master_remaining = 0.0

            # --- SMART REPLICATION LOGIC (CLEAN SWEEPS) ---
            
            # CASE 1: MASTER FULL EXIT (Closing Long or Short)
            if master_remaining == 0 and client_owned_qty != 0:
                if side.lower() == "sell" and client_owned_qty > 0:
                    logger.info(
                        "full_exit_detected",
                        symbol=symbol,
                        client_account_id=client_account["account_id"],
                        message=f"Master exited {symbol}. Closing client's entire long position of {client_owned_qty} shares."
                    )
                    return float(Decimal(str(client_owned_qty)).quantize(Decimal('0.000001'), rounding=ROUND_DOWN))
                
                elif side.lower() == "buy" and client_owned_qty < 0:
                    logger.info(
                        "full_cover_detected",
                        symbol=symbol,
                        client_account_id=client_account["account_id"],
                        message=f"Master covered {symbol}. Closing client's entire short position of {abs(client_owned_qty)} shares."
                    )
                    # For covers, we buy back exactly what we are short (absolute value)
                    return float(Decimal(str(abs(client_owned_qty))).quantize(Decimal('0.000001'), rounding=ROUND_DOWN))

            # CASE 2: NORMAL PROPORTIONAL REPLICATION
            if side.lower() == "sell":
                # Calculate Proportional Quantity
                scaled_qty = self._equity_based_scaling(master_qty, client_equity, self.master_equity)
                
                # Handle Shorting vs Closing
                # Rule: Alpaca does NOT allow fractional short-selling.
                is_shorting = (client_owned_qty - scaled_qty) < -0.0001
                
                if is_shorting:
                    # CASE A: Client has "Dust" (Fractional Long Position)
                    if 0 < client_owned_qty < 1 or (client_owned_qty % 1 > 0.0001):
                        logger.info(
                            "clearing_dust_before_short",
                            client_account_id=client_account["account_id"],
                            symbol=symbol,
                            current_qty=client_owned_qty,
                            message=f"Client has fractional dust ({client_owned_qty}). Selling dust to reach 0.00 before future shorting."
                        )
                        return client_owned_qty

                    # CASE B: Standard Short Sell (Whole Shares Only)
                    final_scaled_qty = float(round(scaled_qty))
                    if final_scaled_qty <= 0: return None
                    
                    logger.info(
                        "executing_short_sell",
                        client_account_id=client_account["account_id"],
                        symbol=symbol,
                        quantity=final_scaled_qty,
                        message=f"Executing whole-share short sell. (Rounded {scaled_qty} to {final_scaled_qty})"
                    )
                    return final_scaled_qty
            else:
                # Standard Buy Logic
                scaled_qty = self._equity_based_scaling(master_qty, client_equity, self.master_equity)
            # -----------------------------------------------
            
            # Calculate percentage of account used by master
            # (Used for descriptive logging)
            allocation_percent = 0.0
            if current_price and self.master_equity > 0:
                allocation_percent = (master_qty * current_price / self.master_equity) * 100
            
            # Apply minimum order size
            if scaled_qty < settings.min_order_size:
                logger.warning(
                    "skipping_trade_quantity_too_small",
                    client_account_id=client_account["account_id"],
                    symbol=symbol,
                    total_wallet_amount=f"${client_equity:,.2f}",
                    allocation_percentage=f"{allocation_percent:.2f}%",
                    master_shares=master_qty,
                    client_shares_calculated=scaled_qty,
                    reason=f"Calculated quantity ({scaled_qty}) is below the allowed minimum of {settings.min_order_size} shares."
                )
                return None
            
            # Validate minimum dollar value (Notional)
            # Alpaca requires at least $1.00 for fractional/notional orders
            if current_price:
                notional_value = scaled_qty * current_price
                if notional_value < settings.min_notional_value:
                    logger.warning(
                        "skipping_trade_dollar_value_too_low",
                        client_account_id=client_account["account_id"],
                        symbol=symbol,
                        total_wallet_amount=f"${client_equity:,.2f}",
                        allocation_percentage=f"{allocation_percent:.2f}%",
                        master_shares=master_qty,
                        client_shares_calculated=scaled_qty,
                        client_trade_amount=f"${notional_value:.2f}",
                        min_required=f"${settings.min_notional_value:.2f}",
                        reason=f"The total trade value (${notional_value:.2f}) is below the minimum required $1.00 for fractional trading."
                    )
                    return None
            
            # Check if symbol supports fractional shares
            supports_fractional = await self._check_fractional_support(symbol, client)
            
            # Round quantity appropriately
            if supports_fractional and settings.allow_fractional_shares:
                # Round to 2 decimal places for fractional shares
                final_qty = float(Decimal(str(scaled_qty)).quantize(Decimal('0.01'), rounding=ROUND_DOWN))
            else:
                # Round down to whole shares
                final_qty = float(int(scaled_qty))
            
            # Validate buying power (rough check)
            if current_price:
                estimated_cost = final_qty * current_price
                if estimated_cost > client_buying_power:
                    logger.warning(
                        "insufficient_buying_power_estimate",
                        client_account_id=client_account["account_id"],
                        symbol=symbol,
                        estimated_cost=estimated_cost,
                        buying_power=client_buying_power,
                        qty=final_qty
                    )
                    # Try to reduce quantity to fit buying power
                    final_qty = float(int(client_buying_power / current_price * 0.95))  # 5% buffer
                    
                    if final_qty < settings.min_order_size:
                        return None
            
            logger.debug(
                "quantity_calculated",
                master_qty=master_qty,
                scaled_qty=scaled_qty,
                final_qty=final_qty,
                client_equity=client_equity,
                master_equity=self.master_equity,
                equity_ratio=f"{(client_equity / self.master_equity * 100):.2f}%",
                symbol=symbol
            )
            
            return final_qty
        
        except Exception as e:
            error_str = str(e).lower()
            client_id = client_account["account_id"]
            
            if "unauthorized" in error_str:
                logger.error(
                    "client_api_credentials_invalid",
                    client_account_id=client_id,
                    symbol=symbol,
                    total_wallet_amount="UNKNOWN (Auth Failed)",
                    error="Unauthorized access. Please verify the API Key and Secret Key for this client.",
                    recommendation="Update client credentials in the database/CSV and reload."
                )
            else:
                logger.error(
                    "calculation_error",
                    client_account_id=client_id,
                    symbol=symbol,
                    total_wallet_amount=f"${client_equity:,.2f}" if 'client_equity' in locals() else "Unknown",
                    error_details=str(e),
                    message="An unexpected error occurred while calculating the client's trade size.",
                    exc_info=True
                )
            return None
    
    def _equity_based_scaling(
        self,
        master_qty: float,
        client_equity: float,
        master_equity: float
    ) -> float:
        """
        Scale quantity based on equity ratio (proportional to account size).
        
        Formula: client_qty = master_qty × (client_equity / master_equity)
        
        This maintains the same % of equity usage across all accounts.
        If master uses 90% of equity, client also uses 90% of equity.
        
        Example:
        - Master has $100k equity, buys 900 shares @ $100 = $90k (90% of equity)
        - Client has $10k equity (10% size of master)
        - Client buys: 900 × (10k / 100k) = 90 shares @ $100 = $9k (also 90% of equity)
        """
        if master_equity <= 0:
            logger.error("invalid_master_equity", master_equity=master_equity)
            return 0.0
        
        ratio = client_equity / master_equity
        scaled_qty = master_qty * ratio
        
        return scaled_qty
    
    async def _check_fractional_support(self, symbol: str, client: TradingClient) -> bool:
        """
        Check if a symbol supports fractional shares.
        
        Args:
            symbol: Trading symbol
            client: Alpaca TradingClient instance
        
        Returns:
            True if fractional shares supported
        """
        try:
            # Get asset info (run in thread pool to avoid blocking)
            asset = await asyncio.to_thread(client.get_asset, symbol)
            
            # Check if asset is fractionable
            return asset.fractionable if hasattr(asset, 'fractionable') else False
        
        except Exception as e:
            logger.warning(
                "failed_to_check_fractional_support",
                symbol=symbol,
                error=str(e)
            )
            # Default to whole shares if we can't determine
            return False
    
    async def get_current_price(self, symbol: str) -> Optional[float]:
        """
        Get current market price for a symbol.
        
        Args:
            symbol: Trading symbol
        
        Returns:
            Current price or None if unavailable
        """
        try:
            # Get latest quote
            from alpaca.data.historical import StockHistoricalDataClient
            from alpaca.data.requests import StockLatestQuoteRequest
            
            data_client = StockHistoricalDataClient(
                api_key=self.master_api_key,
                secret_key=self.master_secret_key
            )
            
            request = StockLatestQuoteRequest(symbol_or_symbols=symbol)
            # Run in thread pool to avoid blocking
            quotes = await asyncio.to_thread(data_client.get_stock_latest_quote, request)
            
            if symbol in quotes:
                quote = quotes[symbol]
                # Use mid price (average of bid and ask)
                mid_price = (float(quote.bid_price) + float(quote.ask_price)) / 2
                return mid_price
            
            return None
        
        except Exception as e:
            logger.error(
                "failed_to_get_current_price",
                symbol=symbol,
                error=str(e)
            )
            return None


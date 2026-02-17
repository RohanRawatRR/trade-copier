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
            
            # Filter trades based on client's trade_direction preference
            trade_direction_filter = client_account.get("trade_direction", "both")
            if trade_direction_filter != "both":
                # Determine if this is a long or short trade based on the master's final position
                # Long trade: Master is buying (opening/adding to long) or has/will have positive position
                # Short trade: Master is selling (opening/adding to short) or has/will have negative position
                is_long_trade = False
                is_short_trade = False
                
                if side.lower() == "buy":
                    # Buying could be: opening long, adding to long, or closing short
                    if master_remaining >= 0:  # Master has long position or will have after this trade
                        is_long_trade = True
                    else:  # Master has short position, this is closing short
                        is_short_trade = True
                elif side.lower() == "sell":
                    # Selling could be: opening short, adding to short, or closing long
                    if master_remaining <= 0:  # Master has short position or will have after this trade
                        is_short_trade = True
                    else:  # Master has long position, this is closing long
                        is_long_trade = True
                
                # Skip trade if it doesn't match client's preference
                if trade_direction_filter == "long" and not is_long_trade:
                    logger.info(
                        "trade_filtered_by_direction",
                        client_account_id=client_account["account_id"],
                        symbol=symbol,
                        side=side,
                        trade_direction_filter=trade_direction_filter,
                        master_remaining=master_remaining,
                        message=f"Client only accepts LONG trades. Skipping this SHORT trade."
                    )
                    return None
                elif trade_direction_filter == "short" and not is_short_trade:
                    logger.info(
                        "trade_filtered_by_direction",
                        client_account_id=client_account["account_id"],
                        symbol=symbol,
                        side=side,
                        trade_direction_filter=trade_direction_filter,
                        master_remaining=master_remaining,
                        message=f"Client only accepts SHORT trades. Skipping this LONG trade."
                    )
                    return None

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
                
                # CASE 1B: Position type mismatch - skip trade
                elif side.lower() == "buy" and client_owned_qty > 0:
                    # Master is closing a short (buying), but client has a long position
                    # Don't copy this trade - it would increase client's long position incorrectly
                    logger.warning(
                        "position_mismatch_skip_trade",
                        symbol=symbol,
                        client_account_id=client_account["account_id"],
                        master_action="closing_short",
                        client_position="long",
                        client_qty=client_owned_qty,
                        message=f"Master closed short position, but client has long position ({client_owned_qty} shares). Skipping trade to avoid position mismatch."
                    )
                    return None
                
                elif side.lower() == "sell" and client_owned_qty < 0:
                    # Master is closing a long (selling), but client has a short position
                    # Don't copy this trade - it would increase client's short position incorrectly
                    logger.warning(
                        "position_mismatch_skip_trade",
                        symbol=symbol,
                        client_account_id=client_account["account_id"],
                        master_action="closing_long",
                        client_position="short",
                        client_qty=abs(client_owned_qty),
                        message=f"Master closed long position, but client has short position ({abs(client_owned_qty)} shares). Skipping trade to avoid position mismatch."
                    )
                    return None
            
            # CASE 1C: Master closing position but client has no position - skip
            # This handles the scenario where:
            # - Master opens a position (buy/sell), but client's order fails
            # - Master then closes the position, but client has no position to close
            # - Without this check, client would enter the opposite direction (e.g., sell when no position = short)
            # Example: Master buys 100 shares → Client buy fails → Master sells 100 shares → Skip client sell (prevents short)
            if master_remaining == 0 and client_owned_qty == 0:
                logger.info(
                    "master_exit_client_no_position",
                    symbol=symbol,
                    client_account_id=client_account["account_id"],
                    master_action=f"closing_{'short' if side.lower() == 'buy' else 'long'}",
                    message=f"Master closed position, but client has no position (likely due to previous trade failure). Skipping trade to prevent entering opposite direction."
                )
                return None
            
            # CASE 1D: Master partially closing position with position type mismatch - skip
            # Check if master is closing a short (buying) but client has opposite/no position
            if side.lower() == "buy" and master_remaining < 0:
                # Master is partially closing a short position
                if client_owned_qty > 0:
                    # Client has a long - buying would increase it, but master is closing
                    logger.warning(
                        "position_mismatch_skip_partial_close",
                        symbol=symbol,
                        client_account_id=client_account["account_id"],
                        master_action="partially_closing_short",
                        client_position="long",
                        client_qty=client_owned_qty,
                        master_remaining=master_remaining,
                        message=f"Master partially closing short position, but client has long position ({client_owned_qty} shares). Skipping trade to avoid position mismatch."
                    )
                    return None
                elif client_owned_qty == 0:
                    # Client has no position - buying would open a long, but master is closing
                    # This handles: Master partially closes short, but client's initial short order failed
                    logger.warning(
                        "position_mismatch_skip_partial_close",
                        symbol=symbol,
                        client_account_id=client_account["account_id"],
                        master_action="partially_closing_short",
                        client_position="none",
                        master_remaining=master_remaining,
                        message=f"Master partially closing short position, but client has no position (likely due to previous trade failure). Skipping trade to avoid opening incorrect position."
                    )
                    return None
            
            # Check if master is closing a long (selling) but client has opposite/no position
            if side.lower() == "sell" and master_remaining > 0:
                # Master is partially closing a long position
                if client_owned_qty < 0:
                    # Client has a short - selling would increase it, but master is closing
                    logger.warning(
                        "position_mismatch_skip_partial_close",
                        symbol=symbol,
                        client_account_id=client_account["account_id"],
                        master_action="partially_closing_long",
                        client_position="short",
                        client_qty=abs(client_owned_qty),
                        master_remaining=master_remaining,
                        message=f"Master partially closing long position, but client has short position ({abs(client_owned_qty)} shares). Skipping trade to avoid position mismatch."
                    )
                    return None
                elif client_owned_qty == 0:
                    # Client has no position - selling would open a short, but master is closing
                    # This handles: Master partially closes long, but client's initial long order failed
                    logger.warning(
                        "position_mismatch_skip_partial_close",
                        symbol=symbol,
                        client_account_id=client_account["account_id"],
                        master_action="partially_closing_long",
                        client_position="none",
                        master_remaining=master_remaining,
                        message=f"Master partially closing long position, but client has no position (likely due to previous trade failure). Skipping trade to avoid opening incorrect position."
                    )
                    return None

            # CASE 2: NORMAL PROPORTIONAL REPLICATION
            # Get risk multiplier from client account config (default to 1.0)
            risk_multiplier = client_account.get("risk_multiplier", 1.0)
            
            if side.lower() == "sell":
                # Calculate Proportional Quantity
                scaled_qty = self._equity_based_scaling(master_qty, client_equity, self.master_equity, risk_multiplier)
                
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
                scaled_qty = self._equity_based_scaling(master_qty, client_equity, self.master_equity, risk_multiplier)
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
        master_equity: float,
        risk_multiplier: float = 1.0
    ) -> float:
        """
        Scale quantity based on equity ratio (proportional to account size) with risk adjustment.
        
        Formula: client_qty = master_qty × (client_equity / master_equity) × risk_multiplier
        
        This maintains the same % of equity usage across all accounts, then applies risk scaling:
        - risk_multiplier = 1.0: Normal scaling (default)
        - risk_multiplier = 0.5: Use 50% of equity (conservative)
        - risk_multiplier = 1.5: Use 150% of equity (margin/aggressive)
        
        Example:
        - Master has $100k equity, buys 900 shares @ $100 = $90k (90% of equity)
        - Client has $10k equity (10% size of master)
        - Base scaling: 900 × (10k / 100k) = 90 shares
        - With 0.5x risk: 90 × 0.5 = 45 shares @ $100 = $4.5k (45% of equity)
        - With 1.5x risk: 90 × 1.5 = 135 shares @ $100 = $13.5k (135% of equity, using margin)
        """
        if master_equity <= 0:
            logger.error("invalid_master_equity", master_equity=master_equity)
            return 0.0
        
        ratio = client_equity / master_equity
        scaled_qty = master_qty * ratio * risk_multiplier
        
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


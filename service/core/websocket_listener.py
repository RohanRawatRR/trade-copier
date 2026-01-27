"""
WebSocket Listener
Monitors master account for real-time trade events via Alpaca WebSocket stream.

Features:
- Automatic reconnection with exponential backoff
- Event deduplication (idempotency)
- Heartbeat monitoring
- Graceful shutdown
"""
import asyncio
from typing import Callable, Optional, Dict, Any
from datetime import datetime, timezone
import structlog

from alpaca.trading.client import TradingClient
from alpaca.trading.stream import TradingStream
from alpaca.trading.enums import OrderSide, OrderType

from config.settings import settings
from monitoring.logging import log_execution_time
from monitoring.alerts import get_alert_manager
from storage.key_store import KeyStore


logger = structlog.get_logger(__name__)


class WebSocketListener:
    """
    Listens to master account trade events via Alpaca WebSocket.
    
    Responsibilities:
    - Connect to Alpaca trade updates stream
    - Handle trade_updates events (fills, orders, etc.)
    - Deduplicate events
    - Auto-reconnect on disconnection
    - Forward valid events to trade dispatcher
    """
    
    def __init__(
        self,
        key_store: KeyStore,
        on_trade_callback: Callable[[Dict[str, Any]], None],
        master_api_key: str,
        master_secret_key: str
    ):
        """
        Initialize WebSocket listener.
        
        Args:
            key_store: KeyStore instance for deduplication
            on_trade_callback: Async callback for processing trade events
            master_api_key: Master account API key
            master_secret_key: Master account secret key
        """
        self.key_store = key_store
        self.on_trade_callback = on_trade_callback
        self.master_api_key = master_api_key
        self.master_secret_key = master_secret_key
        
        # Initialize Alpaca clients
        # TradingClient uses REST API (HTTP), so we can override with ALPACA_BASE_URL
        self.trading_client = TradingClient(
            api_key=self.master_api_key,
            secret_key=self.master_secret_key,
            paper=settings.use_paper_trading,
            url_override=settings.alpaca_base_url if not settings.use_paper_trading else None
        )
        
        # TradingStream uses WebSocket (WSS), so we let it auto-detect based on paper parameter
        # Don't override URL here - the SDK will use the correct WebSocket URL automatically
        self.stream = TradingStream(
            api_key=self.master_api_key,
            secret_key=self.master_secret_key,
            paper=settings.use_paper_trading
        )
        
        # State tracking
        self.is_running = False
        self.is_connected = False
        self.reconnect_attempts = 0
        self.max_reconnect_attempts = 10
        self._stream_task: Optional[asyncio.Task] = None
        self._rate_limited = False  # Track if we hit rate limit (429)
        self._last_rate_limit_time: Optional[float] = None  # Track when we last hit rate limit
        self._connection_lock = asyncio.Lock()  # Prevent concurrent connection attempts
        self._last_connection_attempt: Optional[float] = None  # Track last connection attempt time
        self._rapid_failure_count = 0  # Track rapid consecutive failures
        
        logger.info(
            "websocket_listener_initialized",
            paper_trading=settings.use_paper_trading
        )
    
    async def reconnect_with_new_credentials(self, new_api_key: str, new_secret_key: str):
        """
        Reconnect WebSocket with new master account credentials.
        
        Args:
            new_api_key: New master account API key
            new_secret_key: New master account secret key
        """
        logger.info("websocket_reconnecting_with_new_credentials")
        
        # Stop current connection
        was_running = self.is_running
        if was_running:
            await self.stop()
        
        # Update credentials
        self.master_api_key = new_api_key
        self.master_secret_key = new_secret_key
        
        # Reinitialize Alpaca clients with new credentials
        self.trading_client = TradingClient(
            api_key=self.master_api_key,
            secret_key=self.master_secret_key,
            paper=settings.use_paper_trading,
            url_override=settings.alpaca_base_url if not settings.use_paper_trading else None
        )
        
        # TradingStream uses WebSocket (WSS), so we let it auto-detect based on paper parameter
        self.stream = TradingStream(
            api_key=self.master_api_key,
            secret_key=self.master_secret_key,
            paper=settings.use_paper_trading
        )
        
        # Reset reconnection attempts
        self.reconnect_attempts = 0
        
        logger.info("websocket_clients_reinitialized_with_new_credentials")
        
        # Restart if it was running before
        if was_running:
            await self.start()
            logger.info("websocket_restarted_with_new_credentials")
    
    async def start(self):
        """Start listening to WebSocket stream"""
        if self.is_running:
            logger.warning("websocket_listener_already_running")
            return
        
        self.is_running = True
        
        # Subscribe to trade updates
        self.stream.subscribe_trade_updates(self._handle_trade_update)
        
        # Start stream in background task
        self._stream_task = asyncio.create_task(self._run_stream())
        
        logger.info("websocket_listener_started")
    
    async def stop(self):
        """Stop listening and cleanup"""
        if not self.is_running:
            return
        
        self.is_running = False
        
        # Stop stream
        if self._stream_task and not self._stream_task.done():
            self._stream_task.cancel()
            try:
                await self._stream_task
            except asyncio.CancelledError:
                pass
        
        # Close stream
        try:
            await self.stream.stop_ws()
        except Exception as e:
            logger.error("error_stopping_websocket", error=str(e))
        
        logger.info("websocket_listener_stopped")
    
    async def _run_stream(self):
        """
        Main stream loop with automatic reconnection.
        
        Implements exponential backoff for reconnection attempts.
        """
        while self.is_running:
            # Use lock to prevent concurrent connection attempts
            async with self._connection_lock:
                import time
                current_time = time.time()
                
                # Detect rapid failures (multiple attempts within 2 seconds)
                if self._last_connection_attempt and (current_time - self._last_connection_attempt) < 2:
                    self._rapid_failure_count += 1
                    if self._rapid_failure_count >= 3:
                        # SDK is retrying rapidly - force backoff
                        logger.warning(
                            "websocket_rapid_failures_detected",
                            rapid_failures=self._rapid_failure_count,
                            message="SDK is retrying rapidly - forcing extended backoff",
                            action="Stopping stream and applying backoff"
                        )
                        try:
                            await self.stream.stop_ws()
                        except Exception:
                            pass
                        # Recreate stream to break SDK retry loop
                        self.stream = TradingStream(
                            api_key=self.master_api_key,
                            secret_key=self.master_secret_key,
                            paper=settings.use_paper_trading
                        )
                        self.stream.subscribe_trade_updates(self._handle_trade_update)
                        self._rapid_failure_count = 0
                        # Use extended backoff
                        await self._handle_reconnection(is_rate_limit=True)
                        continue
                else:
                    # Reset counter if enough time has passed
                    self._rapid_failure_count = 0
                
                self._last_connection_attempt = current_time
                
                try:
                    connection_start = time.time()
                    logger.info("websocket_connecting", attempt=self.reconnect_attempts + 1)
                    
                    # Wrap _run_forever() with a short timeout to detect SDK internal retries
                    # If SDK is retrying internally, it will fail quickly (< 3 seconds)
                    # Normal connections either succeed (no timeout) or fail immediately
                    try:
                        # Use 3-second timeout - if SDK retries internally, it will fail quickly
                        await asyncio.wait_for(
                            self.stream._run_forever(),
                            timeout=3.0
                        )
                    except asyncio.TimeoutError:
                        # Timeout after 3 seconds - check if we're connected
                        connection_duration = time.time() - connection_start
                        if not self.is_connected:
                            # Not connected after 3 seconds - SDK was likely retrying internally
                            logger.warning(
                                "websocket_timeout_not_connected",
                                duration_seconds=connection_duration,
                                message="Connection attempt timed out without connecting - SDK likely retrying internally",
                                action="Stopping stream and applying extended backoff"
                            )
                            try:
                                await self.stream.stop_ws()
                            except Exception:
                                pass
                            # Recreate stream
                            self.stream = TradingStream(
                                api_key=self.master_api_key,
                                secret_key=self.master_secret_key,
                                paper=settings.use_paper_trading
                            )
                            self.stream.subscribe_trade_updates(self._handle_trade_update)
                            # Mark as rate limited and trigger extended backoff
                            self._rate_limited = True
                            raise TimeoutError("WebSocket connection timed out - SDK internal retries detected")
                        # If connected, timeout is normal (stream is running) - continue
                        continue
                    except Exception as stream_error:
                        # Check if connection failed very quickly (< 2 seconds)
                        # This indicates SDK was retrying internally
                        connection_duration = time.time() - connection_start
                        if connection_duration < 2.0:
                            logger.warning(
                                "websocket_quick_failure_detected",
                                duration_seconds=connection_duration,
                                error=str(stream_error),
                                message="Connection failed very quickly - SDK likely retrying internally",
                                action="Applying extended backoff"
                            )
                            # Mark as rate limited to use extended backoff
                            self._rate_limited = True
                        # Re-raise so our outer handler can process it
                        raise stream_error
                
                    # If we reach here, stream disconnected
                    self.is_connected = False
                    
                    if not self.is_running:
                        break
                    
                    # Alert about disconnection
                    alert_manager = await get_alert_manager()
                    await alert_manager.alert_websocket_disconnected("Stream ended unexpectedly")
                    
                    # Wait before reconnecting (exponential backoff)
                    await self._handle_reconnection(is_rate_limit=False)
                
                except Exception as e:
                    self.is_connected = False
                    error_str = str(e)
                    error_type = type(e).__name__
                    
                    # Check if this was a very quick failure (SDK retrying internally)
                    quick_failure_detected = False
                    if self._last_connection_attempt:
                        time_since_attempt = time.time() - self._last_connection_attempt
                        if time_since_attempt < 2.0:
                            # Very quick failure - SDK was retrying internally
                            quick_failure_detected = True
                            logger.warning(
                                "websocket_quick_failure_after_exception",
                                time_since_attempt=time_since_attempt,
                                error=error_str,
                                message="Exception occurred very quickly - SDK likely retrying internally",
                                action="Marking as rate limited for extended backoff"
                            )
                            self._rate_limited = True
                    
                    # Stop and recreate the stream to prevent SDK internal retries
                    try:
                        await self.stream.stop_ws()
                    except Exception as stop_error:
                        logger.debug("error_stopping_stream_after_error", error=str(stop_error))
                    
                    # Recreate stream object to prevent SDK from retrying with broken connection
                    try:
                        self.stream = TradingStream(
                            api_key=self.master_api_key,
                            secret_key=self.master_secret_key,
                            paper=settings.use_paper_trading
                        )
                        self.stream.subscribe_trade_updates(self._handle_trade_update)
                    except Exception as recreate_error:
                        logger.error("error_recreating_stream", error=str(recreate_error))
                    
                    # Log the raw error (INFO level so we can see it)
                    logger.info(
                        "websocket_exception_caught",
                        error_type=error_type,
                        error_message=error_str,
                        reconnect_attempts=self.reconnect_attempts,
                        message="Exception caught in websocket stream - stream recreated, applying backoff"
                    )
                    
                    # Check if this is an authentication error
                    is_auth_error = (
                        "failed to authenticate" in error_str.lower() or
                        "authentication" in error_str.lower() or
                        "unauthorized" in error_str.lower() or
                        "401" in error_str or
                        "403" in error_str
                    )
                    
                    # Check if this is a rate limit error (HTTP 429)
                    # Check multiple patterns to catch different error formats
                    is_rate_limit = (
                        "429" in error_str or 
                        "rate limit" in error_str.lower() or 
                        "too many requests" in error_str.lower() or
                        ("server rejected" in error_str.lower() and "429" in error_str)
                    )
                    
                    if is_auth_error:
                        # Authentication errors are critical - log and alert but still retry with longer delay
                        logger.critical(
                            "websocket_authentication_failed",
                            error=error_str,
                            reconnect_attempts=self.reconnect_attempts,
                            message="Authentication failed - check API keys and environment (paper vs live)",
                            paper_trading=settings.use_paper_trading,
                            alpaca_base_url=settings.alpaca_base_url
                        )
                        
                        # Alert about authentication failure
                        alert_manager = await get_alert_manager()
                        await alert_manager.alert_system_error(
                            error=f"WebSocket authentication failed: {error_str}. Check API keys and ensure paper trading setting matches your API keys.",
                            component="WebSocketListener"
                        )
                        
                        if not self.is_running:
                            break
                        
                        # Use extended backoff for auth errors (same as rate limits)
                        await self._handle_reconnection(is_rate_limit=True)
                        
                    elif is_rate_limit or quick_failure_detected:
                        import time
                        self._rate_limited = True
                        self._last_rate_limit_time = time.time()
                        
                        if quick_failure_detected:
                            logger.warning(
                                "websocket_quick_failure_rate_limited",
                                error=error_str,
                                error_type=error_type,
                                reconnect_attempts=self.reconnect_attempts,
                                message="Quick failure detected - SDK retrying internally - using extended backoff",
                                next_delay_seconds=60 * (2 ** (self.reconnect_attempts)),
                                action="Stopping stream and waiting before retry"
                            )
                        else:
                            logger.warning(
                                "websocket_rate_limited",
                                error=error_str,
                                error_type=error_type,
                                reconnect_attempts=self.reconnect_attempts,
                                message="Rate limited by Alpaca (HTTP 429) - using extended backoff",
                                next_delay_seconds=60 * (2 ** (self.reconnect_attempts)),
                                action="Stopping stream and waiting before retry"
                            )
                        
                        # Alert about error (but only once to avoid spam)
                        if self.reconnect_attempts <= 1:  # Alert on first rate limit
                            alert_manager = await get_alert_manager()
                            await alert_manager.alert_websocket_disconnected(
                                f"Rate limited by Alpaca: {error_str}. Using extended backoff."
                            )
                        
                        if not self.is_running:
                            break
                        
                        # Wait before reconnecting (longer delay for rate limits)
                        await self._handle_reconnection(is_rate_limit=True)
                    else:
                        logger.error(
                            "websocket_stream_error",
                            error=error_str,
                            reconnect_attempts=self.reconnect_attempts,
                            exc_info=True
                        )
                        
                        # Alert about error
                        alert_manager = await get_alert_manager()
                        await alert_manager.alert_websocket_disconnected(error_str)
                        
                        if not self.is_running:
                            break
                        
                        # Wait before reconnecting (normal delay)
                        await self._handle_reconnection(is_rate_limit=False)
            
            # Release lock and wait before next iteration
            await asyncio.sleep(0.1)  # Small delay to prevent tight loop
    
    async def _handle_reconnection(self, is_rate_limit: bool = False):
        """
        Handle reconnection logic with exponential backoff.
        
        Args:
            is_rate_limit: If True, use longer delays for rate limit errors (HTTP 429)
        """
        self.reconnect_attempts += 1
        
        if self.reconnect_attempts > self.max_reconnect_attempts:
            logger.critical(
                "websocket_max_reconnect_attempts_exceeded",
                attempts=self.reconnect_attempts
            )
            alert_manager = await get_alert_manager()
            await alert_manager.alert_system_error(
                error=f"Max reconnection attempts ({self.max_reconnect_attempts}) exceeded",
                component="WebSocketListener"
            )
            self.is_running = False
            return
        
        # Use longer delays for rate limit errors (HTTP 429)
        if is_rate_limit or self._rate_limited:
            # For rate limits: start with 60s, then 120s, 240s, etc. (max 10 minutes)
            base_delay = 60  # Start with 1 minute for rate limits
            delay = min(
                base_delay * (2 ** (self.reconnect_attempts - 1)),
                600  # Max 10 minutes for rate limits
            )
            logger.warning(
                "websocket_rate_limit_backoff",
                attempt=self.reconnect_attempts,
                delay_seconds=delay,
                max_attempts=self.max_reconnect_attempts,
                message=f"Rate limited - waiting {delay}s before retry (attempt {self.reconnect_attempts}/{self.max_reconnect_attempts})"
            )
        else:
            # Normal exponential backoff: 5s, 10s, 20s, 40s, etc.
            delay = min(
                settings.websocket_reconnect_delay * (2 ** (self.reconnect_attempts - 1)),
                300  # Max 5 minutes for normal errors
            )
            logger.info(
                "websocket_reconnecting",
                attempt=self.reconnect_attempts,
                max_attempts=self.max_reconnect_attempts,
                delay_seconds=delay
            )
        
        await asyncio.sleep(delay)
    
    @log_execution_time("handle_trade_update")
    async def _handle_trade_update(self, data: Any):
        """
        Process incoming trade update from WebSocket.
        
        Args:
            data: Trade update event from Alpaca
        """
        try:
            # Mark as connected on first successful message
            if not self.is_connected:
                self.is_connected = True
                self.reconnect_attempts = 0
                self._rate_limited = False  # Reset rate limit flag on successful connection
                self._last_rate_limit_time = None  # Reset rate limit timestamp
                self._rapid_failure_count = 0  # Reset rapid failure counter
                self._last_connection_attempt = None  # Reset connection attempt timestamp
                logger.info("websocket_connected")
                
                # Alert successful reconnection
                if self.reconnect_attempts > 0:
                    alert_manager = await get_alert_manager()
                    await alert_manager.alert_websocket_reconnected()
            
            # DEBUG: Log ALL received events for troubleshooting
            logger.info(
                "websocket_event_received",
                event_type=getattr(data, 'event', 'unknown'),
                symbol=getattr(getattr(data, 'order', None), 'symbol', 'unknown'),
                status=getattr(getattr(data, 'order', None), 'status', 'unknown')
            )
            
            # Extract event details
            event_dict = self._parse_trade_event(data)
            
            if not event_dict:
                logger.info(
                    "trade_event_ignored",
                    reason="not_a_fill_event",
                    event_type=getattr(data, 'event', 'unknown'),
                    symbol=getattr(getattr(data, 'order', None), 'symbol', 'unknown')
                )
                return
            
            # Check for duplicate (idempotency)
            is_duplicate = await self.key_store.check_duplicate_event(
                event_dict["event_id"],
                event_dict
            )
            
            if is_duplicate:
                logger.warning(
                    "duplicate_trade_event_ignored",
                    event_id=event_dict["event_id"],
                    order_id=event_dict["order_id"]
                )
                return
            
            # Forward to trade dispatcher
            logger.info(
                "trade_event_received",
                order_id=event_dict["order_id"],
                symbol=event_dict["symbol"],
                side=event_dict["side"],
                qty=event_dict["qty"],
                event_type=event_dict["event_type"]
            )
            
            # Call the callback (trade dispatcher)
            await self.on_trade_callback(event_dict)
        
        except Exception as e:
            logger.error(
                "error_handling_trade_update",
                error=str(e),
                exc_info=True
            )
    
    def _parse_trade_event(self, data: Any) -> Optional[Dict[str, Any]]:
        """
        Parse Alpaca trade event into standardized format.
        
        Args:
            data: Raw trade event from Alpaca
        
        Returns:
            Parsed event dict or None if event should be ignored
        """
        try:
            # Alpaca trade update structure
            event_type = data.event
            order = data.order
            
            # Only process the final 'fill' event to prevent double-buying.
            # Alpaca sends 'partial_fill' for increments and then a 'fill' event 
            # with the cumulative total. By only acting on 'fill', we ensure 
            # the client gets exactly one order for the total amount.
            if event_type != "fill":
                return None
            
            # Extract order details
            return {
                "event_id": f"{order.id}_{event_type}_{data.timestamp}",
                "event_type": event_type,
                "order_id": str(order.id),
                "symbol": order.symbol,
                "side": order.side.value if hasattr(order.side, 'value') else str(order.side),
                "order_type": order.type.value if hasattr(order.type, 'value') else str(order.type),
                "qty": float(order.qty) if order.qty else 0.0,
                "filled_qty": float(order.filled_qty) if order.filled_qty else 0.0,
                "filled_avg_price": float(order.filled_avg_price) if order.filled_avg_price else None,
                "limit_price": float(order.limit_price) if order.limit_price else None,
                "stop_price": float(order.stop_price) if order.stop_price else None,
                "timestamp": data.timestamp,
                "status": order.status.value if hasattr(order.status, 'value') else str(order.status),
            }
        
        except Exception as e:
            logger.error(
                "error_parsing_trade_event",
                error=str(e),
                data=str(data),
                exc_info=True
            )
            return None
    
    def get_connection_status(self) -> Dict[str, Any]:
        """Get current connection status"""
        return {
            "is_running": self.is_running,
            "is_connected": self.is_connected,
            "reconnect_attempts": self.reconnect_attempts,
            "max_reconnect_attempts": self.max_reconnect_attempts,
        }


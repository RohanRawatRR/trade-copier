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
        on_trade_callback: Callable[[Dict[str, Any]], None]
    ):
        """
        Initialize WebSocket listener.
        
        Args:
            key_store: KeyStore instance for deduplication
            on_trade_callback: Async callback for processing trade events
        """
        self.key_store = key_store
        self.on_trade_callback = on_trade_callback
        
        # Initialize Alpaca clients
        self.trading_client = TradingClient(
            api_key=settings.master_api_key,
            secret_key=settings.master_secret_key,
            paper=settings.use_paper_trading,
            url_override=settings.alpaca_base_url if not settings.use_paper_trading else None
        )
        
        self.stream = TradingStream(
            api_key=settings.master_api_key,
            secret_key=settings.master_secret_key,
            paper=settings.use_paper_trading,
            url_override=settings.alpaca_base_url if not settings.use_paper_trading else None
        )
        
        # State tracking
        self.is_running = False
        self.is_connected = False
        self.reconnect_attempts = 0
        self.max_reconnect_attempts = 10
        self._stream_task: Optional[asyncio.Task] = None
        
        logger.info(
            "websocket_listener_initialized",
            master_account=settings.master_account_id,
            paper_trading=settings.use_paper_trading
        )
    
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
            try:
                logger.info("websocket_connecting")
                
                # Run stream (blocks until disconnected)
                # Use _run_forever() directly since we're already in async context
                await self.stream._run_forever()
                
                # If we reach here, stream disconnected
                self.is_connected = False
                
                if not self.is_running:
                    break
                
                # Alert about disconnection
                alert_manager = await get_alert_manager()
                await alert_manager.alert_websocket_disconnected("Stream ended unexpectedly")
                
                # Wait before reconnecting (exponential backoff)
                await self._handle_reconnection()
            
            except Exception as e:
                self.is_connected = False
                logger.error(
                    "websocket_stream_error",
                    error=str(e),
                    reconnect_attempts=self.reconnect_attempts,
                    exc_info=True
                )
                
                # Alert about error
                alert_manager = await get_alert_manager()
                await alert_manager.alert_websocket_disconnected(str(e))
                
                if not self.is_running:
                    break
                
                # Wait before reconnecting
                await self._handle_reconnection()
    
    async def _handle_reconnection(self):
        """Handle reconnection logic with exponential backoff"""
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
        
        # Exponential backoff: 5s, 10s, 20s, 40s, etc.
        delay = min(
            settings.websocket_reconnect_delay * (2 ** (self.reconnect_attempts - 1)),
            300  # Max 5 minutes
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


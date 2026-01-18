"""
Trade Copier Main Application
Production-ready trade replication system for Alpaca.

Usage:
    python main.py

Environment variables configured via .env file or system environment.
"""
import asyncio
import signal
import sys
from pathlib import Path
from typing import Optional
import structlog

# Add the service directory to Python path so imports work regardless of where script is run from
_SERVICE_DIR = Path(__file__).parent.resolve()
if str(_SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(_SERVICE_DIR))

# Ensure Python recognizes this as a package root
# This is needed for relative imports in subpackages to work correctly
import os
os.chdir(_SERVICE_DIR)

# Import uvloop for better async performance (optional but recommended)
try:
    import uvloop
    asyncio.set_event_loop_policy(uvloop.EventLoopPolicy())
except ImportError:
    pass

from config.settings import settings
from storage import KeyStore
from core.websocket_listener import WebSocketListener
from core.trade_dispatcher import TradeDispatcher
from core.order_executor import OrderExecutor
from core.scaling_engine import ScalingEngine
from monitoring.logging import configure_logging
from monitoring.alerts import get_alert_manager


logger = structlog.get_logger(__name__)


class TradeCopierApp:
    """
    Main application orchestrator.
    
    Responsibilities:
    - Initialize all components
    - Start WebSocket listener
    - Handle graceful shutdown
    - Coordinate system lifecycle
    """
    
    def __init__(self):
        self.key_store: Optional[KeyStore] = None
        self.scaling_engine: Optional[ScalingEngine] = None
        self.order_executor: Optional[OrderExecutor] = None
        self.trade_dispatcher: Optional[TradeDispatcher] = None
        self.websocket_listener: Optional[WebSocketListener] = None
        self.alert_manager = None
        
        self.is_running = False
        self._shutdown_event = asyncio.Event()
    
    async def initialize(self):
        """Initialize all system components"""
        logger.info(
            "trade_copier_initializing",
            version="1.0.0",
            environment="production" if settings.is_production else "development",
            master_account=settings.master_account_id
        )
        
        # Initialize key store and database
        self.key_store = KeyStore()
        await self.key_store.initialize()
        logger.info("key_store_initialized")
        
        # Initialize scaling engine
        self.scaling_engine = ScalingEngine()
        await self.scaling_engine.initialize()
        logger.info("scaling_engine_initialized")
        
        # Initialize order executor
        self.order_executor = OrderExecutor(self.key_store)
        logger.info("order_executor_initialized")
        
        # Initialize trade dispatcher
        self.trade_dispatcher = TradeDispatcher(
            self.key_store,
            self.scaling_engine,
            self.order_executor
        )
        logger.info("trade_dispatcher_initialized")
        
        # Initialize alert manager
        self.alert_manager = await get_alert_manager()
        logger.info("alert_manager_initialized")
        
        # Initialize WebSocket listener (last, connects to Alpaca)
        self.websocket_listener = WebSocketListener(
            self.key_store,
            self.trade_dispatcher.dispatch_trade
        )
        logger.info("websocket_listener_initialized")
        
        logger.info("trade_copier_initialized_successfully")
    
    async def start(self):
        """Start the trade copier system"""
        if self.is_running:
            logger.warning("trade_copier_already_running")
            return
        
        self.is_running = True
        
        logger.info("="*80)
        logger.info("TRADE COPIER STARTING")
        logger.info("="*80)
        logger.info(f"Master Account: {settings.master_account_id}")
        logger.info(f"Environment: {'PRODUCTION' if settings.is_production else 'PAPER TRADING'}")
        logger.info(f"Max Concurrent Orders: {settings.max_concurrent_orders}")
        logger.info(f"Scaling Method: equity_based (proportional to account balance)")
        logger.info("="*80)
        
        # Production safety check
        if settings.is_production:
            logger.warning("⚠️  RUNNING IN PRODUCTION MODE - REAL MONEY AT RISK ⚠️")
            logger.warning("Press Ctrl+C within 10 seconds to abort...")
            
            try:
                await asyncio.sleep(10)
            except asyncio.CancelledError:
                logger.info("Startup aborted by user")
                return
        
        # Start WebSocket listener
        await self.websocket_listener.start()
        
        logger.info("trade_copier_running")
        
        # Send startup notification
        if self.alert_manager:
            await self.alert_manager.send_alert(
                title="Trade Copier Started",
                message=f"Trade copier system started successfully in {'PRODUCTION' if settings.is_production else 'PAPER'} mode",
                severity="info" if not settings.is_production else "warning",
                metadata={
                    "master_account": settings.master_account_id,
                    "environment": "production" if settings.is_production else "paper",
                    "max_concurrent": settings.max_concurrent_orders
                }
            )
        
        # Wait for shutdown signal
        await self._shutdown_event.wait()
    
    async def shutdown(self):
        """Graceful shutdown of all components"""
        if not self.is_running:
            return
        
        logger.info("trade_copier_shutting_down")
        
        self.is_running = False
        self._shutdown_event.set()
        
        # Stop WebSocket listener first
        if self.websocket_listener:
            await self.websocket_listener.stop()
            logger.info("websocket_listener_stopped")
        
        # Close database connections
        if self.key_store:
            await self.key_store.close()
            logger.info("key_store_closed")
        
        # Close alert manager
        if self.alert_manager:
            await self.alert_manager.close()
            logger.info("alert_manager_closed")
        
        # Send shutdown notification
        if self.alert_manager and settings.enable_slack_alerts:
            try:
                await self.alert_manager.send_alert(
                    title="Trade Copier Stopped",
                    message="Trade copier system has been shut down",
                    severity="warning"
                )
            except Exception:
                pass  # Ignore errors during shutdown
        
        logger.info("trade_copier_shutdown_complete")
    
    def signal_handler(self, signum, frame):
        """Handle shutdown signals (SIGINT, SIGTERM)"""
        logger.info("shutdown_signal_received", signal=signum)
        asyncio.create_task(self.shutdown())


async def main():
    """Main entry point"""
    # Configure logging
    configure_logging()
    
    # Create application instance
    app = TradeCopierApp()
    
    # Setup signal handlers
    loop = asyncio.get_event_loop()
    
    for sig in (signal.SIGTERM, signal.SIGINT):
        loop.add_signal_handler(
            sig,
            lambda s=sig: asyncio.create_task(app.shutdown())
        )
    
    try:
        # Initialize and start
        await app.initialize()
        await app.start()
    
    except KeyboardInterrupt:
        logger.info("keyboard_interrupt_received")
    
    except Exception as e:
        logger.critical(
            "fatal_error",
            error=str(e),
            exc_info=True
        )
        
        # Try to send critical alert
        try:
            alert_manager = await get_alert_manager()
            await alert_manager.alert_system_error(
                error=str(e),
                component="main"
            )
        except Exception:
            pass
        
        sys.exit(1)
    
    finally:
        # Ensure clean shutdown
        await app.shutdown()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\nShutdown complete.")
    except Exception as e:
        print(f"\nFatal error: {e}", file=sys.stderr)
        sys.exit(1)


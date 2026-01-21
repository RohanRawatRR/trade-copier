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
from datetime import datetime
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
        self.master_account_id: Optional[str] = None
        self.master_api_key: Optional[str] = None
        self.master_secret_key: Optional[str] = None
        self._master_updated_at: Optional[datetime] = None  # Track last known update timestamp
        
        self.is_running = False
        self._shutdown_event = asyncio.Event()
        self._credential_check_task: Optional[asyncio.Task] = None
    
    async def initialize(self):
        """Initialize all system components"""
        logger.info(
            "trade_copier_initializing",
            version="1.0.0",
            environment="production" if settings.is_production else "development"
        )
        
        # Initialize key store and database
        self.key_store = KeyStore()
        await self.key_store.initialize()
        logger.info("key_store_initialized")
        
        # Load master account from database
        master_account = await self.key_store.get_master_account()
        if not master_account:
            raise ValueError(
                "Master account not found in database. "
                "Please configure master account via the Next.js API (POST /api/master)."
            )
        
        self.master_account_id, self.master_api_key, self.master_secret_key = master_account
        
        # Store initial updated_at timestamp for change detection
        metadata = await self.key_store.get_master_account_metadata()
        if metadata:
            self._master_updated_at = metadata[1]
        
        logger.info("master_account_loaded_from_database", account_id=self.master_account_id)
        
        # Initialize scaling engine
        self.scaling_engine = ScalingEngine(
            master_api_key=self.master_api_key,
            master_secret_key=self.master_secret_key
        )
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
            self.trade_dispatcher.dispatch_trade,
            master_api_key=self.master_api_key,
            master_secret_key=self.master_secret_key
        )
        logger.info("websocket_listener_initialized")
        
        logger.info("trade_copier_initialized_successfully")
    
    async def _reload_master_credentials(self):
        """
        Reload master account credentials and reconnect components.
        Called when credential changes are detected.
        """
        try:
            logger.info("master_credentials_changed_detected_reloading")
            
            # Get new credentials from database
            master_account = await self.key_store.get_master_account()
            if not master_account:
                logger.error("master_account_not_found_during_reload")
                return
            
            new_account_id, new_api_key, new_secret_key = master_account
            
            # Get updated timestamp
            metadata = await self.key_store.get_master_account_metadata()
            if metadata:
                new_updated_at = metadata[1]
            else:
                logger.error("master_account_metadata_not_found_during_reload")
                return
            
            # Check if account_id changed (shouldn't happen, but be safe)
            if new_account_id != self.master_account_id:
                logger.warning(
                    "master_account_id_changed",
                    old_account_id=self.master_account_id,
                    new_account_id=new_account_id
                )
            
            # Update cached credentials
            self.master_account_id = new_account_id
            self.master_api_key = new_api_key
            self.master_secret_key = new_secret_key
            self._master_updated_at = new_updated_at
            
            # Reinitialize ScalingEngine with new credentials
            if self.scaling_engine:
                await self.scaling_engine.reinitialize_with_new_credentials(
                    new_api_key, new_secret_key
                )
            
            # Reconnect WebSocket with new credentials
            if self.websocket_listener:
                await self.websocket_listener.reconnect_with_new_credentials(
                    new_api_key, new_secret_key
                )
            
            logger.info(
                "master_credentials_reloaded_successfully",
                account_id=self.master_account_id,
                updated_at=new_updated_at.isoformat()
            )
            
            # Send alert about credential reload
            if self.alert_manager:
                await self.alert_manager.send_alert(
                    title="Master Credentials Reloaded",
                    message=f"Master account credentials were updated and reloaded successfully (Account: {self.master_account_id})",
                    severity="info",
                    metadata={
                        "account_id": self.master_account_id,
                        "updated_at": new_updated_at.isoformat()
                    }
                )
        
        except Exception as e:
            logger.error(
                "error_reloading_master_credentials",
                error=str(e),
                exc_info=True
            )
            
            # Send critical alert
            if self.alert_manager:
                await self.alert_manager.send_alert(
                    title="Failed to Reload Master Credentials",
                    message=f"Error reloading master credentials: {str(e)}. Service may need manual restart.",
                    severity="error",
                    metadata={"error": str(e)}
                )
    
    async def _check_master_credentials_loop(self):
        """
        Background task that periodically checks for master credential changes.
        Runs every `settings.master_credential_check_interval` seconds.
        """
        logger.info(
            "master_credential_check_task_started",
            check_interval_seconds=settings.master_credential_check_interval
        )
        
        while self.is_running:
            try:
                await asyncio.sleep(settings.master_credential_check_interval)
                
                if not self.is_running:
                    break
                
                # Get current master account metadata
                metadata = await self.key_store.get_master_account_metadata()
                if not metadata:
                    logger.warning("master_account_not_found_in_check_loop")
                    continue
                
                current_account_id, current_updated_at = metadata
                
                # Check if credentials have changed
                if self._master_updated_at is None:
                    # First check, just store the timestamp
                    self._master_updated_at = current_updated_at
                    logger.debug(
                        "master_credential_check_initialized",
                        account_id=current_account_id,
                        updated_at=current_updated_at.isoformat()
                    )
                    continue
                
                # Compare timestamps (account for timezone differences)
                if current_updated_at > self._master_updated_at:
                    logger.info(
                        "master_credentials_changed_detected",
                        old_updated_at=self._master_updated_at.isoformat(),
                        new_updated_at=current_updated_at.isoformat()
                    )
                    
                    # Reload credentials
                    await self._reload_master_credentials()
            
            except asyncio.CancelledError:
                logger.info("master_credential_check_task_cancelled")
                break
            
            except Exception as e:
                logger.error(
                    "error_in_master_credential_check_loop",
                    error=str(e),
                    exc_info=True
                )
                # Continue checking even if there's an error
        
        logger.info("master_credential_check_task_stopped")
    
    async def start(self):
        """Start the trade copier system"""
        if self.is_running:
            logger.warning("trade_copier_already_running")
            return
        
        self.is_running = True
        
        logger.info("="*80)
        logger.info("TRADE COPIER STARTING")
        logger.info("="*80)
        logger.info(f"Master Account: {self.master_account_id}")
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
        
        # Start background task to check for credential changes
        self._credential_check_task = asyncio.create_task(self._check_master_credentials_loop())
        
        logger.info("trade_copier_running")
        
        # Send startup notification
        if self.alert_manager:
            await self.alert_manager.send_alert(
                title="Trade Copier Started",
                message=f"Trade copier system started successfully in {'PRODUCTION' if settings.is_production else 'PAPER'} mode",
                severity="info" if not settings.is_production else "warning",
                metadata={
                    "master_account": self.master_account_id,
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
        
        # Stop credential check task
        if self._credential_check_task and not self._credential_check_task.done():
            self._credential_check_task.cancel()
            try:
                await self._credential_check_task
            except asyncio.CancelledError:
                pass
            logger.info("credential_check_task_stopped")
        
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


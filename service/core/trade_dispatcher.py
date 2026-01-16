"""
Trade Dispatcher
Routes trade events from WebSocket to replication pipeline.

Responsibilities:
- Validate trade events
- Fetch active client accounts
- Calculate scaled quantities
- Trigger parallel order execution
"""
import asyncio
from typing import Dict, Any
import structlog

from storage.key_store import KeyStore
from core.scaling_engine import ScalingEngine
from core.order_executor import OrderExecutor
from monitoring.logging import log_execution_time


logger = structlog.get_logger(__name__)


class TradeDispatcher:
    """
    Dispatches master trades to client accounts.
    
    Flow:
    1. Receive trade event from WebSocket
    2. Validate event
    3. Get active client accounts
    4. Calculate scaled quantities for each client
    5. Execute orders in parallel
    """
    
    def __init__(
        self,
        key_store: KeyStore,
        scaling_engine: ScalingEngine,
        order_executor: OrderExecutor
    ):
        self.key_store = key_store
        self.scaling_engine = scaling_engine
        self.order_executor = order_executor
        
        logger.info("trade_dispatcher_initialized")
    
    @log_execution_time("dispatch_trade")
    async def dispatch_trade(self, trade_event: Dict[str, Any]):
        """
        Process and replicate a master trade to all client accounts.
        
        Args:
            trade_event: Trade event dict from WebSocket listener
        """
        try:
            # Extract trade details
            master_order_id = trade_event["order_id"]
            symbol = trade_event["symbol"]
            side = trade_event["side"]
            order_type = trade_event["order_type"]
            qty = trade_event["filled_qty"] or trade_event["qty"]
            price = trade_event.get("filled_avg_price") or trade_event.get("limit_price")
            timestamp = trade_event["timestamp"]
            
            logger.info(
                "dispatching_trade",
                master_order_id=master_order_id,
                symbol=symbol,
                side=side,
                qty=qty,
                order_type=order_type
            )
            
            # Get all active client accounts
            clients = await self.key_store.get_all_active_clients()
            
            if not clients:
                logger.warning(
                    "no_active_clients_found",
                    master_order_id=master_order_id,
                    message="Skipping replication: No active client accounts found in the database."
                )
                return
            
            logger.info(
                "preparing_replication_batch",
                active_client_count=len(clients),
                master_order_id=master_order_id,
                symbol=symbol
            )
            
            # Get current price for scaling calculations
            current_price = await self.scaling_engine.get_current_price(symbol)
            if not current_price:
                current_price = price  # Fallback to fill price
            
            # Calculate scaled quantities for ALL clients in parallel
            scaling_tasks = [
                self.scaling_engine.calculate_client_quantity(
                    master_qty=qty,
                    symbol=symbol,
                    client_account=client,
                    side=side,
                    current_price=current_price
                )
                for client in clients
            ]
            
            # Execute all scaling calculations simultaneously!
            scaled_quantities = await asyncio.gather(*scaling_tasks, return_exceptions=True)
            
            # Build client orders from results
            client_orders = []
            for client, scaled_qty in zip(clients, scaled_quantities):
                # Handle exceptions
                if isinstance(scaled_qty, Exception):
                    logger.error(
                        "client_scaling_failed",
                        client_account_id=client["account_id"],
                        symbol=symbol,
                        error=str(scaled_qty)
                    )
                    continue
                
                # Check if quantity is valid
                if scaled_qty and scaled_qty > 0:
                    client_orders.append({
                        "account_id": client["account_id"],
                        "api_key": client["api_key"],
                        "secret_key": client["secret_key"],
                        "qty": scaled_qty,
                        "master_qty": qty,
                        "scaling_method": client.get("scaling_method")
                    })
                else:
                    logger.debug(
                        "client_order_skipped",
                        client_account_id=client["account_id"],
                        symbol=symbol,
                        reason="quantity_too_small_or_calculation_failed"
                    )
            
            if not client_orders:
                logger.warning(
                    "all_client_trades_skipped",
                    master_order_id=master_order_id,
                    total_clients_checked=len(clients),
                    reason="No clients had enough balance or met the minimum trade size requirements."
                )
                return
            
            logger.info(
                "replication_batch_ready",
                orders_to_execute=len(client_orders),
                master_order_id=master_order_id,
                symbol=symbol
            )
            
            # Execute orders in parallel
            success_count, failure_count = await self.order_executor.execute_orders_batch(
                master_order_id=master_order_id,
                symbol=symbol,
                side=side,
                order_type=order_type,
                master_qty=qty,
                master_price=price,
                master_trade_time=timestamp,
                client_orders=client_orders
            )
            
            logger.info(
                "trade_dispatch_completed",
                master_order_id=master_order_id,
                symbol=symbol,
                total_clients=len(client_orders),
                success_count=success_count,
                failure_count=failure_count
            )
        
        except Exception as e:
            logger.error(
                "trade_dispatch_error",
                master_order_id=trade_event.get("order_id"),
                error=str(e),
                exc_info=True
            )


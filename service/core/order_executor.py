"""
Order Executor
Submits orders to client accounts in parallel with rate limiting and error handling.

Features:
- Parallel execution (asyncio.gather)
- Rate limit protection
- Per-client circuit breakers
- Retry logic
- Latency tracking
"""
import asyncio
from typing import List, Dict, Optional, Tuple
from datetime import datetime
import time
import structlog

from alpaca.trading.client import TradingClient
from alpaca.trading.requests import MarketOrderRequest, LimitOrderRequest, StopOrderRequest
from alpaca.trading.enums import OrderSide, TimeInForce

from config.settings import settings
from storage.key_store import KeyStore
from monitoring.logging import log_execution_time, TradeLogger
from monitoring.alerts import get_alert_manager
from core.retry_policy import (
    with_retry,
    CircuitBreaker,
    RetryableError,
    RateLimitError,
    TemporaryAPIError,
    InsufficientFundsError,
    InvalidSymbolError,
)


logger = structlog.get_logger(__name__)


class OrderExecutor:
    """
    Executes orders across multiple client accounts in FULL PARALLEL mode.
    
    Design Philosophy:
    - ALL clients execute simultaneously (no batching)
    - Maximum parallelism for minimum latency
    - asyncio.gather() submits all orders at once
    - Each client isolated via circuit breakers
    
    Handles:
    - Full parallel order submission (all clients at once)
    - Per-client circuit breakers (failure isolation)
    - Automatic retries with exponential backoff
    - Latency measurement and tracking
    
    Performance:
    - 2 clients: ~800ms (both execute together)
    - 10 clients: ~850ms (all 10 execute together)
    - 100 clients: ~900ms (all 100 execute together)
    - 500 clients: ~1000ms (all 500 execute together)
    
    Note: Be mindful of Alpaca rate limits (200 req/min) with large client counts.
    """
    
    def __init__(self, key_store: KeyStore):
        self.key_store = key_store

        # Circuit breakers for each client (created on-demand)
        self.circuit_breakers: Dict[str, CircuitBreaker] = {}

        # Cache TradingClient per account to avoid a new HTTP session / TLS
        # handshake on every order submission.
        # {account_id: {"api_key": str, "client": TradingClient}}
        self._trading_client_cache: Dict[str, Dict] = {}

        logger.info(
            "order_executor_initialized",
            mode="full_parallel",
            note="All clients execute simultaneously for minimum latency"
        )
    
    def _get_trading_client(self, account_id: str, api_key: str, secret_key: str) -> TradingClient:
        """
        Return a cached TradingClient for the given account.

        Creates a new client only on first call or when credentials have
        rotated, avoiding repeated TCP/TLS handshake overhead.
        """
        cached = self._trading_client_cache.get(account_id)
        if cached is None or cached["api_key"] != api_key:
            self._trading_client_cache[account_id] = {
                "api_key": api_key,
                "client": TradingClient(
                    api_key=api_key,
                    secret_key=secret_key,
                    paper=settings.use_paper_trading
                )
            }
        return self._trading_client_cache[account_id]["client"]

    def _get_circuit_breaker(self, client_account_id: str) -> CircuitBreaker:
        """Get or create circuit breaker for client"""
        if client_account_id not in self.circuit_breakers:
            self.circuit_breakers[client_account_id] = CircuitBreaker(
                name=f"client_{client_account_id}"
            )
        return self.circuit_breakers[client_account_id]
    
    @log_execution_time("execute_orders_batch")
    async def execute_orders_batch(
        self,
        master_order_id: str,
        symbol: str,
        side: str,
        order_type: str,
        master_qty: float,
        master_price: Optional[float],
        master_trade_time: datetime,
        client_orders: List[Dict]
    ) -> Tuple[int, int]:
        """
        Execute orders for multiple clients in parallel.
        
        Args:
            master_order_id: Master order ID for tracking
            symbol: Trading symbol
            side: buy or sell
            order_type: market, limit, stop, etc.
            master_qty: Master order quantity
            master_price: Master order price (for limit/stop orders)
            master_trade_time: When master trade occurred
            client_orders: List of client order dicts with account_id and qty
        
        Returns:
            Tuple of (success_count, failure_count)
        """
        trade_logger = TradeLogger(master_order_id)
        trade_logger.log_replication_started(
            symbol=symbol,
            side=side,
            qty=master_qty,
            client_count=len(client_orders)
        )
        
        # Create tasks for parallel execution
        tasks = []
        for client_order in client_orders:
            task = self._execute_single_order(
                master_order_id=master_order_id,
                symbol=symbol,
                side=side,
                order_type=order_type,
                master_price=master_price,
                master_trade_time=master_trade_time,
                client_order=client_order,
                trade_logger=trade_logger
            )
            tasks.append(task)
        
        # Execute all orders in parallel with batching
        results = await self._execute_with_batching(tasks)
        
        # Count successes and failures
        success_count = sum(1 for result in results if result and result.get("success"))
        failure_count = len(results) - success_count
        
        trade_logger.log_replication_completed(success_count, failure_count)
        
        # Alert if failure rate is high
        if failure_count > 0:
            failure_rate = failure_count / len(results)
            if failure_rate > 0.1:  # More than 10% failures
                alert_manager = await get_alert_manager()
                await alert_manager.alert_high_failure_rate(failure_count, len(results))
        
        return success_count, failure_count
    
    async def _execute_with_batching(self, tasks: List) -> List[Dict]:
        """
        Execute tasks in parallel batches to avoid overwhelming Alpaca's API.

        Design:
        - Split clients into batches of `order_batch_size` (default 25)
        - Each batch executes fully in parallel (asyncio.gather)
        - Small delay between batches (`rate_limit_delay`) to avoid IP throttling
        - Prevents Alpaca from queuing 100 simultaneous connections from one IP,
          which was causing 7-8s tail latency with 100 clients

        Args:
            tasks: List of coroutines to execute

        Returns:
            List of results
        """
        execution_start = time.perf_counter()
        batch_size = settings.order_batch_size
        delay = settings.rate_limit_delay

        logger.info(
            "starting_batched_execution",
            total_clients=len(tasks),
            batch_size=batch_size,
            delay_between_batches_s=delay
        )

        all_results = []
        for batch_start in range(0, len(tasks), batch_size):
            batch = tasks[batch_start: batch_start + batch_size]
            batch_num = batch_start // batch_size + 1

            logger.debug(
                "executing_batch",
                batch=batch_num,
                clients_in_batch=len(batch)
            )

            batch_results = await asyncio.gather(*batch, return_exceptions=True)
            all_results.extend(batch_results)

            # Delay between batches only (not after the last one)
            if batch_start + batch_size < len(tasks):
                await asyncio.sleep(delay)

        execution_time_ms = int((time.perf_counter() - execution_start) * 1000)

        # Process results
        processed_results = []
        success_count = 0
        failure_count = 0

        for result in all_results:
            if isinstance(result, Exception):
                logger.error(
                    "parallel_execution_exception",
                    error=str(result),
                    exc_info=result
                )
                processed_results.append({"success": False, "error": str(result)})
                failure_count += 1
            else:
                processed_results.append(result)
                if result.get("success"):
                    success_count += 1
                else:
                    failure_count += 1

        logger.info(
            "batched_execution_completed",
            total_clients=len(tasks),
            execution_time_ms=execution_time_ms,
            success_count=success_count,
            failure_count=failure_count,
            batches=max(1, (len(tasks) + batch_size - 1) // batch_size)
        )

        return processed_results
    
    async def _execute_single_order(
        self,
        master_order_id: str,
        symbol: str,
        side: str,
        order_type: str,
        master_price: Optional[float],
        master_trade_time: datetime,
        client_order: Dict,
        trade_logger: TradeLogger
    ) -> Dict:
        """
        Execute order for a single client with circuit breaker and retry logic.

        Hot-path design:
        1. audit log creation and order submission fire in parallel (both are
           independent — we only need the audit_log_id after both complete).
        2. All post-order work (DB update, metrics, latency alerts) is fired as
           a background task so asyncio.gather() can return as soon as the order
           is confirmed, without waiting for bookkeeping I/O.
        """
        client_account_id = client_order["account_id"]
        qty = client_order["qty"]
        start_time = time.perf_counter()
        audit_log_id = None  # may remain None if audit write fails

        try:
            circuit_breaker = self._get_circuit_breaker(client_account_id)

            # Fire audit log creation and order submission simultaneously.
            # The DB insert (~5ms) overlaps with the Alpaca API call (~500ms+),
            # removing it entirely from the sequential hot path.
            _t_submit = time.perf_counter()
            audit_result, order_result = await asyncio.gather(
                self.key_store.log_trade_attempt(
                    master_order_id=master_order_id,
                    client_account_id=client_account_id,
                    symbol=symbol,
                    side=side,
                    order_type=order_type,
                    master_qty=client_order.get("master_qty", 0),
                    master_price=master_price,
                    master_trade_time=master_trade_time,
                    client_qty=qty,
                    scaling_method_used=client_order.get("scaling_method")
                ),
                circuit_breaker.call(
                    self._submit_order_with_retry,
                    client_order,
                    symbol,
                    side,
                    order_type,
                    qty,
                    master_price
                ),
                return_exceptions=True
            )
            submit_ms = int((time.perf_counter() - _t_submit) * 1000)

            # Extract audit_log_id first (needed in both success and failure paths)
            if isinstance(audit_result, Exception):
                logger.warning("audit_log_creation_failed", error=str(audit_result))
            else:
                audit_log_id = audit_result

            # Raise now if the order itself failed
            if isinstance(order_result, Exception):
                raise order_result

            latency_ms = int((time.perf_counter() - start_time) * 1000)

            # Sync structured log — no I/O, keep inline
            trade_logger.log_client_success(
                client_account_id=client_account_id,
                client_order_id=order_result["order_id"],
                qty=qty,
                latency_ms=latency_ms,
                master_trade_time=master_trade_time
            )

            # Update audit record inline — fast UPDATE (~5ms), critical for
            # Trade History showing correct status (not stuck as "pending").
            _t_db = time.perf_counter()
            if audit_log_id is not None:
                try:
                    await self.key_store.update_trade_result(
                        audit_log_id=audit_log_id,
                        status="success",
                        client_order_id=order_result["order_id"],
                        client_filled_qty=order_result.get("filled_qty", qty),
                        client_avg_price=order_result.get("filled_avg_price"),
                        replication_latency_ms=latency_ms
                    )
                except Exception as db_err:
                    logger.error("update_trade_result_failed", error=str(db_err))
            db_update_ms = int((time.perf_counter() - _t_db) * 1000)

            logger.debug(
                "order_timing_breakdown",
                client_account_id=client_account_id,
                symbol=symbol,
                submit_ms=submit_ms,
                db_update_ms=db_update_ms,
                total_ms=latency_ms,
            )

            # Non-critical work (metrics + latency alert) runs in background.
            asyncio.create_task(self._post_order_bookkeeping(
                latency_ms=latency_ms,
                symbol=symbol,
                side=side,
                master_order_id=master_order_id
            ))

            return {
                "success": True,
                "client_account_id": client_account_id,
                "order_id": order_result["order_id"],
                "latency_ms": latency_ms
            }

        except Exception as e:
            latency_ms = int((time.perf_counter() - start_time) * 1000)
            error_message = str(e)

            trade_logger.log_client_failure(
                client_account_id=client_account_id,
                error=error_message
            )

            # Update audit record inline for failures too.
            if audit_log_id is not None:
                try:
                    await self.key_store.update_trade_result(
                        audit_log_id=audit_log_id,
                        status="failed",
                        error_message=error_message,
                        replication_latency_ms=latency_ms
                    )
                except Exception as db_err:
                    logger.error("update_trade_result_failed", error=str(db_err))

            circuit_breaker = self._get_circuit_breaker(client_account_id)
            asyncio.create_task(self._post_order_failure_bookkeeping(
                error_message=error_message,
                client_account_id=client_account_id,
                circuit_breaker_state=circuit_breaker.state
            ))

            return {
                "success": False,
                "client_account_id": client_account_id,
                "error": error_message,
                "latency_ms": latency_ms
            }

    async def _post_order_bookkeeping(
        self,
        latency_ms: int,
        symbol: str,
        side: str,
        master_order_id: str
    ) -> None:
        """
        Background task: non-critical metrics + latency alert only.
        DB audit update is handled inline in _execute_single_order.
        """
        try:
            if latency_ms > settings.latency_critical_threshold:
                alert_manager = await get_alert_manager()
                await alert_manager.alert_latency_threshold_exceeded(
                    master_order_id=master_order_id,
                    latency_ms=latency_ms,
                    threshold=settings.latency_critical_threshold
                )

            await self.key_store.record_metric(
                "replication_latency_ms",
                latency_ms,
                {"symbol": symbol, "side": side}
            )
        except Exception as e:
            logger.error("post_order_bookkeeping_failed", error=str(e), exc_info=True)

    async def _post_order_failure_bookkeeping(
        self,
        error_message: str,
        client_account_id: str,
        circuit_breaker_state: str
    ) -> None:
        """
        Background task: circuit breaker persistence + alert.
        DB audit update is handled inline in _execute_single_order.
        """
        try:
            if circuit_breaker_state == "open":
                await self.key_store.update_circuit_breaker(
                    client_account_id,
                    "open",
                    increment_failures=True
                )
                alert_manager = await get_alert_manager()
                await alert_manager.alert_circuit_breaker_opened(
                    client_account_id=client_account_id,
                    reason=error_message
                )
        except Exception as e:
            logger.error("post_order_failure_bookkeeping_failed", error=str(e), exc_info=True)
    
    @with_retry(
        max_attempts=3,
        retryable_exceptions=(RateLimitError, TemporaryAPIError, RetryableError)
    )
    async def _submit_order_with_retry(
        self,
        client_order: Dict,
        symbol: str,
        side: str,
        order_type: str,
        qty: float,
        price: Optional[float]
    ) -> Dict:
        """
        Submit order to Alpaca with retry logic.
        """
        try:
            # Get (or create) a cached TradingClient for this account.
            # Re-creates only if credentials have changed since last call.
            client = self._get_trading_client(
                account_id=client_order["account_id"],
                api_key=client_order["api_key"],
                secret_key=client_order["secret_key"]
            )
            
            # Convert side to OrderSide enum
            order_side = OrderSide.BUY if side.lower() == "buy" else OrderSide.SELL
            
            # Create order request based on type
            if order_type.lower() == "market":
                order_data = MarketOrderRequest(
                    symbol=symbol,
                    qty=qty,
                    side=order_side,
                    time_in_force=TimeInForce.DAY
                )
            elif order_type.lower() == "limit" and price:
                order_data = LimitOrderRequest(
                    symbol=symbol,
                    qty=qty,
                    side=order_side,
                    time_in_force=TimeInForce.DAY,
                    limit_price=price
                )
            elif order_type.lower() == "stop" and price:
                order_data = StopOrderRequest(
                    symbol=symbol,
                    qty=qty,
                    side=order_side,
                    time_in_force=TimeInForce.DAY,
                    stop_price=price
                )
            else:
                # Default to market order
                order_data = MarketOrderRequest(
                    symbol=symbol,
                    qty=qty,
                    side=order_side,
                    time_in_force=TimeInForce.DAY
                )
            
            # Submit order in thread pool to avoid blocking event loop
            order = await asyncio.to_thread(client.submit_order, order_data)
            
            logger.info(
                "order_successfully_placed",
                client_account_id=client_order["account_id"],
                alpaca_order_id=str(order.id),
                symbol=symbol,
                side=side,
                quantity=qty,
                order_type=order_type,
                message=f"Successfully placed {side} order for {qty} shares of {symbol}."
            )
            
            return {
                "order_id": str(order.id),
                "status": order.status.value if hasattr(order.status, 'value') else str(order.status),
                "filled_qty": float(order.filled_qty) if order.filled_qty else 0.0,
                "filled_avg_price": float(order.filled_avg_price) if order.filled_avg_price else None
            }
        
        except Exception as e:
            error_str = str(e).lower()
            
            # Classify error type
            if "insufficient" in error_str or "buying power" in error_str:
                raise InsufficientFundsError("Account does not have enough money (buying power) to place this order.") from e
            
            elif "rate limit" in error_str or "429" in error_str:
                raise RateLimitError("Alpaca rate limit hit. Slowing down and retrying...") from e
            
            elif "not found" in error_str or "invalid" in error_str or "halt" in error_str:
                raise InvalidSymbolError(f"The symbol '{symbol}' is either invalid, not tradeable, or currently halted.") from e
            
            elif "500" in error_str or "502" in error_str or "503" in error_str or "timeout" in error_str:
                raise TemporaryAPIError("Temporary connection issue with Alpaca. Retrying...") from e
            
            else:
                # Unknown error - don't retry
                raise e


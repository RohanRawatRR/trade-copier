"""
Structured Logging Configuration
Production-grade logging with structured JSON output for log aggregation systems.

Features:
- Structured logging with contextual metadata
- JSON output for ELK/Datadog/CloudWatch
- Automatic correlation IDs for request tracing
- Performance timing decorators
- Separate error log files for easy debugging
"""
import structlog
import logging
import sys
from pathlib import Path
from typing import Dict, Optional
from datetime import datetime, timezone
from functools import wraps
import time
import asyncio
from logging.handlers import RotatingFileHandler

from config.settings import settings


def configure_logging():
    """
    Configure structlog with production-ready processors and file handlers.
    
    Pipeline:
    1. Add timestamps in ISO format
    2. Add log level
    3. Add exception info if present
    4. Format as JSON (for production) or console (for dev)
    
    Output Destinations:
    - Console (stdout): All logs
    - logs/all.log: All logs (rotated at 100MB)
    - logs/errors.log: Errors and warnings only (rotated at 50MB)
    """
    
    # Create logs directory
    logs_dir = Path("logs")
    logs_dir.mkdir(exist_ok=True)
    
    # Determine if we're in development mode
    is_dev = settings.log_level == "DEBUG" or not settings.enable_structured_logging
    
    # Shared processors
    shared_processors = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.StackInfoRenderer(),
        structlog.processors.format_exc_info,
    ]
    
    # Configure structlog to use standard library LoggerFactory
    structlog.configure(
        processors=shared_processors + [
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )
    
    # Define the final formatters
    if is_dev:
        formatter = structlog.stdlib.ProcessorFormatter(
            processor=structlog.dev.ConsoleRenderer(colors=True),
        )
    else:
        formatter = structlog.stdlib.ProcessorFormatter(
            processor=structlog.processors.JSONRenderer(),
        )
    
    # Configure standard library logging with multiple handlers
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.getLevelName(settings.log_level))
    
    # Clear any existing handlers
    root_logger.handlers.clear()
    
    # Handler 1: Console (stdout)
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.getLevelName(settings.log_level))
    console_handler.setFormatter(formatter)
    root_logger.addHandler(console_handler)
    
    # Handler 2: All logs file
    all_logs_file = logs_dir / "all.log"
    all_logs_handler = RotatingFileHandler(
        all_logs_file,
        maxBytes=100 * 1024 * 1024,
        backupCount=5,
        encoding="utf-8"
    )
    all_logs_handler.setLevel(logging.getLevelName(settings.log_level))
    all_logs_handler.setFormatter(formatter)
    root_logger.addHandler(all_logs_handler)
    
    # Handler 3: Error logs only
    error_logs_file = logs_dir / "errors.log"
    error_logs_handler = RotatingFileHandler(
        error_logs_file,
        maxBytes=50 * 1024 * 1024,
        backupCount=10,
        encoding="utf-8"
    )
    error_logs_handler.setLevel(logging.WARNING)
    error_logs_handler.setFormatter(formatter)
    root_logger.addHandler(error_logs_handler)
    
    logger = structlog.get_logger(__name__)
    logger.info(
        "logging_configured",
        log_level=settings.log_level,
        structured=settings.enable_structured_logging,
        is_production=settings.is_production,
        log_files={
            "all_logs": str(all_logs_file),
            "error_logs": str(error_logs_file)
        }
    )


def log_execution_time(operation_name: str):
    """
    Decorator to log execution time of async/sync functions.
    
    Usage:
        @log_execution_time("replicate_trade")
        async def replicate_to_client(client_id, order):
            ...
    """
    def decorator(func):
        logger = structlog.get_logger(func.__module__)
        
        if asyncio.iscoroutinefunction(func):
            @wraps(func)
            async def async_wrapper(*args, **kwargs):
                start_time = time.perf_counter()
                try:
                    result = await func(*args, **kwargs)
                    duration_ms = int((time.perf_counter() - start_time) * 1000)
                    logger.debug(
                        f"{operation_name}_completed",
                        operation=operation_name,
                        duration_ms=duration_ms,
                        function=func.__name__
                    )
                    return result
                except Exception as e:
                    duration_ms = int((time.perf_counter() - start_time) * 1000)
                    logger.error(
                        f"{operation_name}_failed",
                        operation=operation_name,
                        duration_ms=duration_ms,
                        function=func.__name__,
                        error=str(e),
                        exc_info=True
                    )
                    raise
            return async_wrapper
        else:
            @wraps(func)
            def sync_wrapper(*args, **kwargs):
                start_time = time.perf_counter()
                try:
                    result = func(*args, **kwargs)
                    duration_ms = int((time.perf_counter() - start_time) * 1000)
                    logger.debug(
                        f"{operation_name}_completed",
                        operation=operation_name,
                        duration_ms=duration_ms,
                        function=func.__name__
                    )
                    return result
                except Exception as e:
                    duration_ms = int((time.perf_counter() - start_time) * 1000)
                    logger.error(
                        f"{operation_name}_failed",
                        operation=operation_name,
                        duration_ms=duration_ms,
                        function=func.__name__,
                        error=str(e),
                        exc_info=True
                    )
                    raise
            return sync_wrapper
    return decorator


class TradeLogger:
    """
    Specialized logger for trade events with automatic audit trail.
    
    Provides context-aware logging for:
    - Trade initiation
    - Replication progress
    - Success/failure tracking
    - Latency monitoring
    
    Failed trades are logged to both:
    - Main error.log (with all other errors)
    - Dedicated failed_trades.log (trade failures only)
    """
    
    # Class-level file handler for failed trades (shared across all instances)
    _failed_trades_handler = None
    
    @classmethod
    def _get_failed_trades_handler(cls):
        """Get or create the failed trades file handler"""
        if cls._failed_trades_handler is None:
            logs_dir = Path("logs")
            logs_dir.mkdir(exist_ok=True)
            
            failed_trades_file = logs_dir / "failed_trades.log"
            cls._failed_trades_handler = RotatingFileHandler(
                failed_trades_file,
                maxBytes=50 * 1024 * 1024,  # 50MB
                backupCount=10,
                encoding="utf-8"
            )
            cls._failed_trades_handler.setLevel(logging.ERROR)
            cls._failed_trades_handler.setFormatter(logging.Formatter("%(message)s"))
        
        return cls._failed_trades_handler
    
    def __init__(self, master_order_id: str):
        self.master_order_id = master_order_id
        self.logger = structlog.get_logger(__name__)
        self.start_time = time.perf_counter()
        
        # Add failed trades handler to this logger
        self._setup_failed_trades_logging()
    
    def log_replication_started(self, symbol: str, side: str, qty: float, client_count: int):
        """Log the start of trade replication"""
        self.logger.info(
            "replication_process_started",
            master_order_id=self.master_order_id,
            symbol=symbol,
            side=side,
            total_shares=qty,
            client_count=client_count,
            message=f"Starting replication of {side} {qty} {symbol} to {client_count} client(s)."
        )
    
    def log_client_success(
        self,
        client_account_id: str,
        client_order_id: str,
        qty: float,
        latency_ms: int,
        master_trade_time: Optional[datetime] = None
    ):
        """Log successful replication to a client"""
        total_lag_ms = None
        if master_trade_time:
            # Calculate total time from master fill to client completion
            now = datetime.now(timezone.utc)
            # Ensure master_trade_time is timezone-aware for comparison
            if master_trade_time.tzinfo is None:
                master_trade_time = master_trade_time.replace(tzinfo=timezone.utc)
            total_lag_ms = int((now - master_trade_time).total_seconds() * 1000)

        self.logger.info(
            "client_replication_successful",
            master_order_id=self.master_order_id,
            client_account_id=client_account_id,
            alpaca_order_id=client_order_id,
            shares=qty,
            internal_processing_time=f"{latency_ms}ms",
            total_platform_lag=f"{total_lag_ms}ms" if total_lag_ms else "N/A",
            message=f"Success: Client {client_account_id} replicated. [Our Time: {latency_ms}ms | Total Lag: {total_lag_ms}ms]"
        )
        
        # Check latency thresholds
        if latency_ms > settings.latency_critical_threshold:
            self.logger.warning(
                "latency_critical_threshold_exceeded",
                master_order_id=self.master_order_id,
                client_account_id=client_account_id,
                latency_ms=latency_ms,
                threshold=settings.latency_critical_threshold
            )
        elif latency_ms > settings.latency_warning_threshold:
            self.logger.warning(
                "latency_warning_threshold_exceeded",
                master_order_id=self.master_order_id,
                client_account_id=client_account_id,
                latency_ms=latency_ms,
                threshold=settings.latency_warning_threshold
            )
    
    def _setup_failed_trades_logging(self):
        """Setup dedicated logging for failed trades"""
        # Handler is class-level and shared across all instances
        # No per-instance setup needed
    
    def log_client_failure(
        self,
        client_account_id: str,
        error: str,
        retry_count: int = 0
    ):
        """
        Log failed replication to a client.
        
        Logged to:
        - Console (stdout)
        - logs/all.log (all logs)
        - logs/errors.log (errors only)
        - logs/failed_trades.log (trade failures only)
        """
        # Log to standard channels (includes errors.log)
        self.logger.error(
            "client_replication_failed",
            master_order_id=self.master_order_id,
            client_account_id=client_account_id,
            error=error,
            retry_count=retry_count
        )
        
        # Also log to dedicated failed trades file
        failed_trades_handler = self._get_failed_trades_handler()
        
        # Create a JSON record for the failed trade
        import json
        failed_trade_record = {
            "event": "client_replication_failed",
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": "error",
            "master_order_id": self.master_order_id,
            "client_account_id": client_account_id,
            "error": error,
            "retry_count": retry_count
        }
        
        # Write to failed trades file
        failed_trades_handler.emit(
            logging.LogRecord(
                name="trade_failures",
                level=logging.ERROR,
                pathname="",
                lineno=0,
                msg=json.dumps(failed_trade_record),
                args=(),
                exc_info=None
            )
        )
    
    def log_replication_completed(self, success_count: int, failure_count: int):
        """Log completion of trade replication batch"""
        total_time_ms = int((time.perf_counter() - self.start_time) * 1000)
        self.logger.info(
            "overall_replication_finished",
            master_order_id=self.master_order_id,
            total_successful=success_count,
            total_failed=failure_count,
            total_duration_ms=total_time_ms,
            success_rate=f"{(success_count / (success_count + failure_count) * 100):.2f}%" if (success_count + failure_count) > 0 else "0%",
            message=f"Replication batch finished. {success_count} succeeded, {failure_count} failed. Total time: {total_time_ms}ms."
        )


class LatencyTracker:
    """
    Track and report latency metrics.
    
    Calculates:
    - Individual operation latency
    - Percentiles (p50, p95, p99)
    - Moving averages
    """
    
    def __init__(self):
        self.latencies: list[float] = []
        self.logger = structlog.get_logger(__name__)
    
    def record(self, latency_ms: float):
        """Record a latency measurement"""
        self.latencies.append(latency_ms)
        
        # Keep only last 1000 measurements for memory efficiency
        if len(self.latencies) > 1000:
            self.latencies = self.latencies[-1000:]
    
    def get_percentiles(self) -> Dict[str, float]:
        """Calculate latency percentiles"""
        if not self.latencies:
            return {}
        
        sorted_latencies = sorted(self.latencies)
        count = len(sorted_latencies)
        
        return {
            "p50": sorted_latencies[int(count * 0.50)],
            "p95": sorted_latencies[int(count * 0.95)],
            "p99": sorted_latencies[int(count * 0.99)],
            "min": sorted_latencies[0],
            "max": sorted_latencies[-1],
            "avg": sum(sorted_latencies) / count,
        }
    
    def log_summary(self):
        """Log latency summary statistics"""
        percentiles = self.get_percentiles()
        if percentiles:
            self.logger.info("latency_summary", **percentiles, sample_size=len(self.latencies))
    
    def reset(self):
        """Clear latency history"""
        self.latencies.clear()


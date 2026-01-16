"""
Retry Policy
Implements exponential backoff with jitter for resilient API calls.

Features:
- Configurable retry attempts
- Exponential backoff
- Jitter to prevent thundering herd
- Selective retry based on error type
"""
import asyncio
import random
from typing import Callable, TypeVar, Optional, Type, Tuple
from functools import wraps
import structlog

from config.settings import settings


logger = structlog.get_logger(__name__)

T = TypeVar('T')


class RetryableError(Exception):
    """Base class for errors that should trigger retries"""
    pass


class RateLimitError(RetryableError):
    """Rate limit exceeded (HTTP 429)"""
    pass


class TemporaryAPIError(RetryableError):
    """Temporary API error (5xx, timeouts)"""
    pass


class NonRetryableError(Exception):
    """Errors that should NOT be retried"""
    pass


class InsufficientFundsError(NonRetryableError):
    """Insufficient buying power"""
    pass


class InvalidSymbolError(NonRetryableError):
    """Invalid or halted symbol"""
    pass


def calculate_backoff_delay(
    attempt: int,
    initial_delay: float,
    max_delay: float,
    exponential_base: int,
    jitter: bool
) -> float:
    """
    Calculate backoff delay with exponential growth and optional jitter.
    
    Args:
        attempt: Current attempt number (0-indexed)
        initial_delay: Base delay in seconds
        max_delay: Maximum delay cap
        exponential_base: Base for exponential growth (typically 2)
        jitter: Whether to add random jitter
    
    Returns:
        Delay in seconds
    """
    # Exponential backoff: initial * (base ^ attempt)
    delay = min(initial_delay * (exponential_base ** attempt), max_delay)
    
    # Add jitter: random value between 0 and delay
    if jitter:
        delay = random.uniform(0, delay)
    
    return delay


def with_retry(
    max_attempts: Optional[int] = None,
    initial_delay: Optional[float] = None,
    max_delay: Optional[float] = None,
    exponential_base: Optional[int] = None,
    jitter: Optional[bool] = None,
    retryable_exceptions: Tuple[Type[Exception], ...] = (RetryableError,),
):
    """
    Decorator to add retry logic to async functions.
    
    Usage:
        @with_retry(max_attempts=3)
        async def submit_order(client, order_data):
            return await client.submit_order(**order_data)
    
    Args:
        max_attempts: Maximum retry attempts (None = use settings default)
        initial_delay: Initial backoff delay (None = use settings default)
        max_delay: Maximum backoff delay (None = use settings default)
        exponential_base: Exponential base (None = use settings default)
        jitter: Enable jitter (None = use settings default)
        retryable_exceptions: Tuple of exception types to retry
    """
    # Use settings defaults if not specified
    max_attempts = max_attempts or settings.max_retry_attempts
    initial_delay = initial_delay or settings.retry_initial_delay
    max_delay = max_delay or settings.retry_max_delay
    exponential_base = exponential_base or settings.retry_exponential_base
    jitter = jitter if jitter is not None else settings.retry_jitter
    
    def decorator(func: Callable[..., T]) -> Callable[..., T]:
        @wraps(func)
        async def wrapper(*args, **kwargs) -> T:
            last_exception = None
            
            for attempt in range(max_attempts + 1):  # +1 for initial attempt
                try:
                    result = await func(*args, **kwargs)
                    
                    # Log retry success if this wasn't the first attempt
                    if attempt > 0:
                        logger.info(
                            "retry_succeeded",
                            function=func.__name__,
                            attempt=attempt,
                            total_attempts=attempt + 1
                        )
                    
                    return result
                
                except retryable_exceptions as e:
                    last_exception = e
                    
                    # Check if we have attempts left
                    if attempt >= max_attempts:
                        logger.error(
                            "retry_exhausted",
                            function=func.__name__,
                            total_attempts=attempt + 1,
                            error=str(e)
                        )
                        raise
                    
                    # Calculate backoff delay
                    delay = calculate_backoff_delay(
                        attempt,
                        initial_delay,
                        max_delay,
                        exponential_base,
                        jitter
                    )
                    
                    logger.warning(
                        "retry_attempt",
                        function=func.__name__,
                        attempt=attempt + 1,
                        max_attempts=max_attempts + 1,
                        delay_seconds=f"{delay:.2f}",
                        error=str(e)
                    )
                    
                    # Wait before retrying
                    await asyncio.sleep(delay)
                
                except NonRetryableError as e:
                    logger.error(
                        "non_retryable_error",
                        function=func.__name__,
                        error=str(e)
                    )
                    raise
                
                except Exception as e:
                    # Unexpected error - don't retry
                    logger.error(
                        "unexpected_error_no_retry",
                        function=func.__name__,
                        error=str(e),
                        exc_info=True
                    )
                    raise
            
            # Should never reach here, but just in case
            if last_exception:
                raise last_exception
        
        return wrapper
    return decorator


class CircuitBreaker:
    """
    Circuit breaker pattern for protecting failing services.
    
    States:
    - CLOSED: Normal operation, requests allowed
    - OPEN: Too many failures, requests blocked
    - HALF_OPEN: Testing if service recovered
    
    Prevents cascading failures by failing fast when a service is down.
    """
    
    def __init__(
        self,
        failure_threshold: Optional[int] = None,
        timeout_seconds: Optional[int] = None,
        name: str = "circuit_breaker"
    ):
        self.failure_threshold = failure_threshold or settings.failure_threshold
        self.timeout_seconds = timeout_seconds or settings.circuit_timeout
        self.name = name
        
        self.failure_count = 0
        self.last_failure_time: Optional[float] = None
        self.state = "closed"  # closed, open, half_open
    
    def _should_attempt_reset(self) -> bool:
        """Check if circuit should attempt reset from OPEN to HALF_OPEN"""
        if self.state != "open":
            return False
        
        if self.last_failure_time is None:
            return False
        
        import time
        elapsed = time.time() - self.last_failure_time
        return elapsed >= self.timeout_seconds
    
    async def call(self, func: Callable[..., T], *args, **kwargs) -> T:
        """
        Execute function with circuit breaker protection.
        
        Args:
            func: Async function to call
            *args, **kwargs: Arguments to pass to function
        
        Returns:
            Function result
        
        Raises:
            Exception: If circuit is open or function fails
        """
        # Check if we should attempt reset
        if self._should_attempt_reset():
            self.state = "half_open"
            logger.info(
                "circuit_breaker_half_open",
                name=self.name,
                failure_count=self.failure_count
            )
        
        # Block requests if circuit is open
        if self.state == "open":
            logger.warning(
                "circuit_breaker_blocked_request",
                name=self.name,
                failure_count=self.failure_count
            )
            raise Exception(f"Circuit breaker '{self.name}' is OPEN")
        
        try:
            result = await func(*args, **kwargs)
            
            # Success - reset circuit if it was half-open
            if self.state == "half_open":
                self.state = "closed"
                self.failure_count = 0
                self.last_failure_time = None
                logger.info(
                    "circuit_breaker_closed",
                    name=self.name
                )
            
            return result
        
        except Exception as e:
            self._record_failure()
            raise
    
    def _record_failure(self):
        """Record a failure and potentially open the circuit"""
        import time
        
        self.failure_count += 1
        self.last_failure_time = time.time()
        
        if self.failure_count >= self.failure_threshold:
            self.state = "open"
            logger.error(
                "circuit_breaker_opened",
                name=self.name,
                failure_count=self.failure_count,
                threshold=self.failure_threshold
            )
        else:
            logger.warning(
                "circuit_breaker_failure_recorded",
                name=self.name,
                failure_count=self.failure_count,
                threshold=self.failure_threshold
            )
    
    def reset(self):
        """Manually reset circuit breaker"""
        self.state = "closed"
        self.failure_count = 0
        self.last_failure_time = None
        logger.info("circuit_breaker_manually_reset", name=self.name)
    
    def get_state(self) -> dict:
        """Get current circuit breaker state"""
        return {
            "name": self.name,
            "state": self.state,
            "failure_count": self.failure_count,
            "failure_threshold": self.failure_threshold,
            "last_failure_time": self.last_failure_time,
        }


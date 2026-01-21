"""
Secure API Key Storage
Handles encryption/decryption of client API credentials using Fernet symmetric encryption.

Security model:
1. Keys are encrypted at rest in the database
2. Encryption key (ENCRYPTION_KEY) is stored in environment/secrets manager
3. Keys are only decrypted in memory when needed
4. No plaintext keys ever touch disk
5. Connection pooling minimizes decryption operations
"""
from cryptography.fernet import Fernet
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy import select, update
from typing import Optional, List, Dict, Tuple
from datetime import datetime, timezone, timedelta
import hashlib

from .models import Base, ClientAccount, MasterAccount, TradeAuditLog, SystemMetrics, DeduplicationCache
from config.settings import settings
import structlog

logger = structlog.get_logger(__name__)


class KeyStore:
    """
    Thread-safe, async key storage with encryption.
    
    Features:
    - Automatic encryption/decryption
    - Connection pooling for high-concurrency
    - Circuit breaker state management
    - Credential rotation support
    """
    
    def __init__(self):
        self.cipher_suite = Fernet(settings.encryption_key.encode())
        
        # Configure engine with database-specific settings
        engine_kwargs = {
            "echo": settings.log_level == "DEBUG",
        }
        
        # SQLite doesn't support connection pooling - only add pool settings for other databases
        if not settings.database_url.startswith("sqlite"):
            engine_kwargs.update({
                "pool_size": 20,  # Support 500+ clients with connection pooling
                "max_overflow": 50,
                "pool_pre_ping": True,  # Verify connections before use
                "pool_recycle": 3600,  # Recycle connections every hour
            })
        
        self.engine = create_async_engine(settings.database_url, **engine_kwargs)
        self.async_session = async_sessionmaker(
            self.engine,
            class_=AsyncSession,
            expire_on_commit=False,
        )
    
    async def initialize(self):
        """Create database tables if they don't exist"""
        from sqlalchemy.exc import OperationalError, ProgrammingError
        
        async with self.engine.begin() as conn:
            try:
                # Use checkfirst=True to avoid errors if tables already exist
                # This is especially important when sharing database with Prisma
                await conn.run_sync(
                    lambda sync_conn: Base.metadata.create_all(
                        sync_conn, checkfirst=True
                    )
                )
            except (OperationalError, ProgrammingError) as e:
                # Handle case where indexes/tables already exist (e.g., created by Prisma or previous run)
                # PostgreSQL raises ProgrammingError for duplicate indexes, SQLite raises OperationalError
                error_msg = str(e).lower()
                if any(keyword in error_msg for keyword in ["already exists", "duplicate", "relation", "already defined"]):
                    logger.warning(
                        "database_objects_already_exist",
                        message="Some database objects (tables/indexes) already exist. This is normal when sharing database with Prisma or on restart. Continuing...",
                        error=str(e)
                    )
                    # Continue execution - tables exist, which is what we want
                else:
                    # Re-raise if it's a different error
                    raise
        logger.info("database_initialized", database_url=settings.database_url)
    
    async def close(self):
        """Close database connections"""
        await self.engine.dispose()
        logger.info("database_connections_closed")
    
    def _encrypt(self, plaintext: str) -> str:
        """Encrypt a string (API key or secret)"""
        return self.cipher_suite.encrypt(plaintext.encode()).decode()
    
    def _decrypt(self, encrypted: str) -> str:
        """Decrypt a string (API key or secret)"""
        return self.cipher_suite.decrypt(encrypted.encode()).decode()
    
    async def add_client_account(
        self,
        account_id: str,
        api_key: str,
        secret_key: str,
        email: Optional[str] = None,
        account_name: Optional[str] = None,
        scaling_method: Optional[str] = None,
        scaling_multiplier: Optional[float] = None,
        is_active: bool = True,
    ) -> ClientAccount:
        """
        Add or update a client account with encrypted credentials.
        
        Args:
            account_id: Alpaca account ID
            api_key: Plaintext API key (will be encrypted)
            secret_key: Plaintext secret key (will be encrypted)
            email: Optional email for notifications
            account_name: Optional friendly name
            scaling_method: Optional per-client scaling override
            scaling_multiplier: Optional per-client multiplier override
            is_active: Whether the account is active
        
        Returns:
            ClientAccount model instance
        """
        encrypted_api = self._encrypt(api_key)
        encrypted_secret = self._encrypt(secret_key)
        
        async with self.async_session() as session:
            # Check if account exists
            stmt = select(ClientAccount).where(ClientAccount.account_id == account_id)
            result = await session.execute(stmt)
            existing = result.scalar_one_or_none()
            
            if existing:
                # Update existing account
                existing.encrypted_api_key = encrypted_api
                existing.encrypted_secret_key = encrypted_secret
                existing.email = email
                existing.account_name = account_name
                existing.scaling_method = scaling_method
                existing.scaling_multiplier = scaling_multiplier
                existing.is_active = is_active
                existing.updated_at = datetime.now(timezone.utc)
                account = existing
                logger.info(
                    "client_account_updated",
                    account_id=account_id,
                    account_name=account_name
                )
            else:
                # Create new account
                account = ClientAccount(
                    account_id=account_id,
                    encrypted_api_key=encrypted_api,
                    encrypted_secret_key=encrypted_secret,
                    email=email,
                    account_name=account_name,
                    scaling_method=scaling_method,
                    scaling_multiplier=scaling_multiplier,
                    is_active=is_active,
                )
                session.add(account)
                logger.info(
                    "client_account_added",
                    account_id=account_id,
                    account_name=account_name
                )
            
            await session.commit()
            await session.refresh(account)
            return account
    
    async def get_client_by_account_id(self, account_id: str) -> Optional[ClientAccount]:
        """Get a client account by ID"""
        async with self.async_session() as session:
            stmt = select(ClientAccount).where(ClientAccount.account_id == account_id)
            result = await session.execute(stmt)
            return result.scalar_one_or_none()

    async def get_client_credentials(self, account_id: str) -> Optional[Tuple[str, str]]:
        """
        Retrieve and decrypt credentials for a specific client.
        
        Returns:
            Tuple of (api_key, secret_key) or None if account not found/inactive
        """
        async with self.async_session() as session:
            stmt = select(ClientAccount).where(
                ClientAccount.account_id == account_id,
                ClientAccount.is_active == True
            )
            result = await session.execute(stmt)
            account = result.scalar_one_or_none()
            
            if not account:
                logger.warning("client_account_not_found", account_id=account_id)
                return None
            
            api_key = self._decrypt(account.encrypted_api_key)
            secret_key = self._decrypt(account.encrypted_secret_key)
            return (api_key, secret_key)
    
    async def get_all_active_clients(self) -> List[Dict]:
        """
        Get all active clients with circuit breaker state = closed.
        
        Returns:
            List of dicts with account_id, credentials, and scaling config
        """
        async with self.async_session() as session:
            stmt = select(ClientAccount).where(
                ClientAccount.is_active == True,
                ClientAccount.circuit_breaker_state == "closed"
            )
            result = await session.execute(stmt)
            accounts = result.scalars().all()
            
            clients = []
            for account in accounts:
                clients.append({
                    "account_id": account.account_id,
                    "api_key": self._decrypt(account.encrypted_api_key),
                    "secret_key": self._decrypt(account.encrypted_secret_key),
                    "email": account.email,
                    "scaling_method": account.scaling_method,
                    "scaling_multiplier": account.scaling_multiplier,
                })
            
            logger.info("active_clients_retrieved", count=len(clients))
            return clients
    
    async def update_circuit_breaker(
        self,
        account_id: str,
        state: str,
        increment_failures: bool = False
    ):
        """
        Update circuit breaker state for a client account.
        
        Args:
            account_id: Client account ID
            state: "closed", "open", or "half_open"
            increment_failures: If True, increment failure counter
        """
        async with self.async_session() as session:
            updates = {
                "circuit_breaker_state": state,
                "updated_at": datetime.now(timezone.utc)
            }
            
            if increment_failures:
                # Increment failure count atomically
                stmt = (
                    update(ClientAccount)
                    .where(ClientAccount.account_id == account_id)
                    .values(
                        circuit_breaker_state=state,
                        failure_count=ClientAccount.failure_count + 1,
                        last_failure_time=datetime.now(timezone.utc),
                        updated_at=datetime.now(timezone.utc)
                    )
                )
            else:
                # Reset failures if circuit is closing
                if state == "closed":
                    updates["failure_count"] = 0
                    updates["last_failure_time"] = None
                
                stmt = (
                    update(ClientAccount)
                    .where(ClientAccount.account_id == account_id)
                    .values(**updates)
                )
            
            await session.execute(stmt)
            await session.commit()
            
            logger.info(
                "circuit_breaker_updated",
                account_id=account_id,
                state=state,
                increment_failures=increment_failures
            )
    
    async def deactivate_client(self, account_id: str):
        """Deactivate a client account (soft delete)"""
        async with self.async_session() as session:
            stmt = (
                update(ClientAccount)
                .where(ClientAccount.account_id == account_id)
                .values(is_active=False, updated_at=datetime.now(timezone.utc))
            )
            await session.execute(stmt)
            await session.commit()
            logger.info("client_account_deactivated", account_id=account_id)

    async def delete_client_account(self, account_id: str) -> bool:
        """Permanently delete a client account from the database"""
        from sqlalchemy import delete
        async with self.async_session() as session:
            stmt = delete(ClientAccount).where(ClientAccount.account_id == account_id)
            result = await session.execute(stmt)
            await session.commit()
            
            deleted = result.rowcount > 0
            if deleted:
                logger.info("client_account_deleted", account_id=account_id)
            return deleted
    
    async def log_trade_attempt(
        self,
        master_order_id: str,
        client_account_id: str,
        symbol: str,
        side: str,
        order_type: str,
        master_qty: float,
        master_price: Optional[float],
        master_trade_time: datetime,
        client_qty: Optional[float] = None,
        scaling_method_used: Optional[str] = None,
    ) -> int:
        """
        Create audit log entry for trade replication attempt.
        
        Returns:
            Audit log ID for updating later
        """
        async with self.async_session() as session:
            audit_log = TradeAuditLog(
                master_order_id=master_order_id,
                client_account_id=client_account_id,
                symbol=symbol,
                side=side,
                order_type=order_type,
                master_qty=master_qty,
                master_price=master_price,
                master_trade_time=master_trade_time,
                client_qty=client_qty,
                scaling_method_used=scaling_method_used,
                status="pending",
            )
            session.add(audit_log)
            await session.commit()
            await session.refresh(audit_log)
            return audit_log.id
    
    async def update_trade_result(
        self,
        audit_log_id: int,
        status: str,
        client_order_id: Optional[str] = None,
        client_filled_qty: Optional[float] = None,
        client_avg_price: Optional[float] = None,
        error_message: Optional[str] = None,
        retry_count: int = 0,
        replication_latency_ms: Optional[int] = None,
    ):
        """Update audit log with trade execution result"""
        async with self.async_session() as session:
            stmt = (
                update(TradeAuditLog)
                .where(TradeAuditLog.id == audit_log_id)
                .values(
                    status=status,
                    client_order_id=client_order_id,
                    client_filled_qty=client_filled_qty,
                    client_avg_price=client_avg_price,
                    error_message=error_message,
                    retry_count=retry_count,
                    replication_latency_ms=replication_latency_ms,
                    replication_completed_at=datetime.now(timezone.utc)
                )
            )
            await session.execute(stmt)
            await session.commit()
    
    async def check_duplicate_event(self, event_id: str, event_data: dict) -> bool:
        """
        Check if event has already been processed (idempotency).
        
        Args:
            event_id: Unique event identifier from WebSocket
            event_data: Event payload for content hashing
        
        Returns:
            True if duplicate, False if new
        """
        # Create content hash
        content_str = str(sorted(event_data.items()))
        content_hash = hashlib.sha256(content_str.encode()).hexdigest()
        
        async with self.async_session() as session:
            # Clean up expired entries first
            now = datetime.now(timezone.utc)
            await session.execute(
                DeduplicationCache.__table__.delete().where(
                    DeduplicationCache.expires_at < now
                )
            )
            
            # Check for duplicate by event_id or content_hash
            stmt = select(DeduplicationCache).where(
                (DeduplicationCache.event_id == event_id) |
                (DeduplicationCache.content_hash == content_hash)
            )
            result = await session.execute(stmt)
            existing = result.scalar_one_or_none()
            
            if existing:
                logger.warning(
                    "duplicate_event_detected",
                    event_id=event_id,
                    original_event_id=existing.event_id
                )
                return True
            
            # Store new event
            cache_entry = DeduplicationCache(
                event_id=event_id,
                event_type=event_data.get("event", "unknown"),
                content_hash=content_hash,
                expires_at=now + timedelta(hours=24)  # Keep for 24h
            )
            session.add(cache_entry)
            await session.commit()
            return False
    
    async def record_metric(self, metric_name: str, value: float, tags: Optional[Dict] = None):
        """Record a system metric for monitoring"""
        import json
        async with self.async_session() as session:
            metric = SystemMetrics(
                metric_name=metric_name,
                metric_value=value,
                tags=json.dumps(tags) if tags else None
            )
            session.add(metric)
            await session.commit()
    
    async def get_master_account(self) -> Optional[Tuple[str, str, str]]:
        """
        Get active master account credentials.
        
        Returns:
            Tuple of (account_id, api_key, secret_key) or None if not found
        """
        async with self.async_session() as session:
            result = await session.execute(
                select(MasterAccount).where(MasterAccount.is_active == True)
            )
            master = result.scalar_one_or_none()
            
            if not master:
                return None
            
            # Decrypt credentials
            api_key = self._decrypt(master.encrypted_api_key)
            secret_key = self._decrypt(master.encrypted_secret_key)
            
            return (master.account_id, api_key, secret_key)
    
    async def update_master_account(
        self,
        account_id: str,
        api_key: str,
        secret_key: str,
    ) -> MasterAccount:
        """
        Update or create master account with encrypted credentials.
        
        Args:
            account_id: Alpaca account ID
            api_key: Plaintext API key (will be encrypted)
            secret_key: Plaintext secret key (will be encrypted)
        
        Returns:
            MasterAccount instance
        """
        async with self.async_session() as session:
            # Deactivate any existing active master accounts
            await session.execute(
                update(MasterAccount)
                .where(MasterAccount.is_active == True)
                .values(is_active=False)
            )
            
            # Check if account_id already exists
            result = await session.execute(
                select(MasterAccount).where(MasterAccount.account_id == account_id)
            )
            existing = result.scalar_one_or_none()
            
            if existing:
                # Update existing
                existing.encrypted_api_key = self._encrypt(api_key)
                existing.encrypted_secret_key = self._encrypt(secret_key)
                existing.is_active = True
                existing.updated_at = datetime.now(timezone.utc)
                await session.commit()
                await session.refresh(existing)
                return existing
            else:
                # Create new
                master = MasterAccount(
                    account_id=account_id,
                    encrypted_api_key=self._encrypt(api_key),
                    encrypted_secret_key=self._encrypt(secret_key),
                    is_active=True,
                )
                session.add(master)
                await session.commit()
                await session.refresh(master)
                return master


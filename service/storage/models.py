"""
Database Models
SQLAlchemy models for storing client credentials and trade audit logs.
"""
from sqlalchemy import Column, String, DateTime, Float, Integer, Boolean, Text, Index
from sqlalchemy.ext.asyncio import AsyncAttrs
from sqlalchemy.orm import DeclarativeBase
from datetime import datetime, timezone
from typing import Optional


class Base(AsyncAttrs, DeclarativeBase):
    """Async-compatible declarative base"""
    pass


class MasterAccount(Base):
    """
    Stores encrypted master account credentials.
    
    Security considerations:
    - API keys are encrypted at rest using Fernet symmetric encryption
    - Keys are only decrypted in memory when needed
    - No plaintext keys ever touch disk
    """
    __tablename__ = "master_accounts"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    account_id = Column(String(50), unique=True, nullable=False)
    encrypted_api_key = Column(Text, nullable=False)
    encrypted_secret_key = Column(Text, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)
    
    # Audit fields
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)
    
    # Indexes (explicitly named to avoid conflicts)
    # Note: account_id doesn't need explicit index - unique=True already creates one
    __table_args__ = (
        Index('ix_master_accounts_is_active', 'is_active'),
    )


class ClientAccount(Base):
    """
    Stores encrypted client account credentials.
    
    Security considerations:
    - API keys are encrypted at rest using Fernet symmetric encryption
    - Keys are only decrypted in memory when needed
    - No plaintext keys ever touch disk
    """
    __tablename__ = "client_accounts"
    
    account_id = Column(String(50), primary_key=True, index=True)
    encrypted_api_key = Column(Text, nullable=False)
    encrypted_secret_key = Column(Text, nullable=False)
    
    # Account metadata
    email = Column(String(255), nullable=True)
    account_name = Column(String(255), nullable=True)
    
    # Status tracking
    is_active = Column(Boolean, default=True, nullable=False, index=True)
    circuit_breaker_state = Column(String(20), default="closed", nullable=False)  # closed, open, half_open
    failure_count = Column(Integer, default=0, nullable=False)
    last_failure_time = Column(DateTime(timezone=True), nullable=True)
    
    # Scaling configuration (per-client overrides)
    scaling_method = Column(String(50), nullable=True)  # None = use global default
    scaling_multiplier = Column(Float, nullable=True)
    risk_multiplier = Column(Float, default=1.0, nullable=False)  # Risk scaling: 0.5 = 50%, 1.5 = 150% (margin)
    trade_direction = Column(String(20), default="both", nullable=False)  # Trade filter: "long", "short", or "both"
    
    # Audit fields
    created_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    updated_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), onupdate=lambda: datetime.now(timezone.utc), nullable=False)
    last_successful_trade = Column(DateTime(timezone=True), nullable=True)
    
    # Indexes for common queries
    __table_args__ = (
        Index('idx_active_accounts', 'is_active', 'circuit_breaker_state'),
    )


class TradeAuditLog(Base):
    """
    Compliance-grade audit trail for all trade replications.
    
    Stores:
    - Master trade details
    - Client replication attempts
    - Latency metrics
    - Success/failure reasons
    """
    __tablename__ = "trade_audit_logs"
    
    # Primary key
    id = Column(Integer, primary_key=True, autoincrement=True)
    
    # Trade identification
    master_order_id = Column(String(50), nullable=False, index=True)
    client_account_id = Column(String(50), nullable=False, index=True)
    client_order_id = Column(String(50), nullable=True)
    
    # Master trade details
    symbol = Column(String(20), nullable=False, index=True)
    side = Column(String(10), nullable=False)  # buy, sell
    order_type = Column(String(20), nullable=False)  # market, limit, stop, etc.
    master_qty = Column(Float, nullable=False)
    master_price = Column(Float, nullable=True)
    
    # Client trade details
    client_qty = Column(Float, nullable=True)
    client_filled_qty = Column(Float, nullable=True)
    client_avg_price = Column(Float, nullable=True)
    scaling_method_used = Column(String(50), nullable=True)
    
    # Status tracking
    status = Column(String(20), nullable=False, index=True)  # pending, success, failed, partial
    error_message = Column(Text, nullable=True)
    retry_count = Column(Integer, default=0, nullable=False)
    
    # Latency metrics (milliseconds)
    replication_latency_ms = Column(Integer, nullable=True)
    order_submission_latency_ms = Column(Integer, nullable=True)
    
    # Timestamps
    master_trade_time = Column(DateTime(timezone=True), nullable=False)
    replication_started_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    replication_completed_at = Column(DateTime(timezone=True), nullable=True)
    
    # Indexes for common queries and compliance reporting
    __table_args__ = (
        Index('idx_master_order', 'master_order_id'),
        Index('idx_client_trades', 'client_account_id', 'status'),
        Index('idx_symbol_trades', 'symbol', 'master_trade_time'),
        Index('idx_failed_trades', 'status', 'replication_started_at'),
        Index('idx_latency_analysis', 'replication_latency_ms', 'master_trade_time'),
    )


class SystemMetrics(Base):
    """
    Time-series metrics for monitoring system health.
    
    Tracks:
    - WebSocket connection status
    - Replication throughput
    - Error rates
    - Latency percentiles
    """
    __tablename__ = "system_metrics"
    
    id = Column(Integer, primary_key=True, autoincrement=True)
    timestamp = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False, index=True)
    
    # Metric type and value
    metric_name = Column(String(100), nullable=False, index=True)
    metric_value = Column(Float, nullable=False)
    
    # Tags for filtering
    tags = Column(Text, nullable=True)  # JSON string for flexible tagging
    
    __table_args__ = (
        Index('idx_metric_time', 'metric_name', 'timestamp'),
    )


class DeduplicationCache(Base):
    """
    Prevents duplicate trade processing from WebSocket reconnects.
    
    Stores:
    - Event IDs from master account
    - Processing timestamps
    - TTL for automatic cleanup
    """
    __tablename__ = "deduplication_cache"
    
    event_id = Column(String(100), primary_key=True)
    event_type = Column(String(50), nullable=False)
    processed_at = Column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)
    
    # Store event hash to detect duplicate content with different IDs
    content_hash = Column(String(64), nullable=False, index=True)
    
    __table_args__ = (
        Index('idx_expiry_cleanup', 'expires_at'),
    )


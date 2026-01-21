"""
Configuration Management
Centralized settings using Pydantic for validation and type safety.
"""
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Literal, Optional
from pathlib import Path


# Find the service directory (where this file is located)
_SERVICE_DIR = Path(__file__).parent.parent.resolve()
_ENV_FILE = _SERVICE_DIR / '.env'


class Settings(BaseSettings):
    """Production-grade configuration with validation"""
    
    model_config = SettingsConfigDict(
        env_file=str(_ENV_FILE) if _ENV_FILE.exists() else None,
        env_file_encoding='utf-8',
        case_sensitive=False,
        extra='ignore'
    )
    
    # Database
    database_url: str = "sqlite+aiosqlite:///./trade_copier.db"
    
    # Encryption
    encryption_key: str
    
    # Alpaca Configuration
    alpaca_base_url: str = "https://paper-api.alpaca.markets"
    alpaca_data_url: str = "https://data.alpaca.markets"
    use_paper_trading: bool = True
    
    # Performance Settings
    max_concurrent_orders: int = Field(default=500, ge=1, le=1000)
    order_batch_size: int = Field(default=100, ge=1, le=200)
    rate_limit_delay: float = Field(default=0.05, ge=0.01, le=1.0)
    websocket_reconnect_delay: int = Field(default=5, ge=1, le=60)
    
    # Scaling Configuration
    # Uses equity-based scaling: client_qty = master_qty × (client_equity / master_equity)
    # This maintains proportional equity usage across all accounts
    min_order_size: float = Field(default=0.01, ge=0.0001)
    min_notional_value: float = Field(default=1.0, ge=0.0)  # Alpaca minimum is $1.00
    allow_fractional_shares: bool = True
    
    # Circuit Breaker Settings
    failure_threshold: int = Field(default=5, ge=1)
    circuit_timeout: int = Field(default=300, ge=10)
    
    # Monitoring & Alerting
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"
    enable_structured_logging: bool = True
    enable_metrics: bool = True
    metrics_port: int = Field(default=9090, ge=1024, le=65535)
    
    # Slack Notifications
    slack_webhook_url: Optional[str] = None
    slack_alert_channel: str = "#trading-alerts"
    enable_slack_alerts: bool = False
    
    # Email Notifications
    smtp_host: Optional[str] = None
    smtp_port: int = 587
    smtp_user: Optional[str] = None
    smtp_password: Optional[str] = None
    alert_email_to: Optional[str] = None
    enable_email_alerts: bool = False
    
    # Latency Thresholds (milliseconds)
    latency_warning_threshold: int = Field(default=150, ge=1)
    latency_critical_threshold: int = Field(default=200, ge=1)
    
    # Retry Configuration
    max_retry_attempts: int = Field(default=3, ge=0, le=10)
    retry_initial_delay: float = Field(default=1.0, ge=0.1)
    retry_max_delay: float = Field(default=10.0, ge=1.0)
    retry_exponential_base: int = Field(default=2, ge=2, le=10)
    retry_jitter: bool = True
    
    @field_validator('latency_critical_threshold')
    @classmethod
    def validate_latency_thresholds(cls, v, info):
        if 'latency_warning_threshold' in info.data and v <= info.data['latency_warning_threshold']:
            raise ValueError('latency_critical_threshold must be greater than latency_warning_threshold')
        return v
    
    @field_validator('encryption_key')
    @classmethod
    def validate_encryption_key(cls, v):
        if not v or v == 'your_fernet_key_here':
            raise ValueError('encryption_key must be set to a valid Fernet key')
        return v
    
    @property
    def is_production(self) -> bool:
        """Check if running in production mode"""
        return not self.use_paper_trading and 'paper' not in self.alpaca_base_url.lower()


# Singleton instance
_settings: Optional[Settings] = None


def get_settings() -> Settings:
    """Get or create settings singleton"""
    global _settings
    if _settings is None:
        _settings = Settings()
    return _settings


# Convenience export
settings = get_settings()


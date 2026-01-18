# Try relative imports first (works when imported as package)
# Fall back to direct imports if relative imports fail
try:
    from .key_store import KeyStore
    from .models import ClientAccount, TradeAuditLog, SystemMetrics, DeduplicationCache
except (ImportError, ModuleNotFoundError):
    # Fallback: import directly (works when run as script)
    import sys
    from pathlib import Path
    _storage_dir = Path(__file__).parent
    _service_dir = _storage_dir.parent
    if str(_service_dir) not in sys.path:
        sys.path.insert(0, str(_service_dir))
    from storage.key_store import KeyStore
    from storage.models import ClientAccount, TradeAuditLog, SystemMetrics, DeduplicationCache

__all__ = [
    'KeyStore',
    'ClientAccount',
    'TradeAuditLog',
    'SystemMetrics',
    'DeduplicationCache',
]


# Import modules using importlib to handle package structure correctly
import sys
import importlib.util
from pathlib import Path

_storage_dir = Path(__file__).parent
_service_dir = _storage_dir.parent

# Ensure service directory is in path
if str(_service_dir) not in sys.path:
    sys.path.insert(0, str(_service_dir))

# Create storage package in sys.modules if it doesn't exist
if 'storage' not in sys.modules:
    import types
    _storage_pkg = types.ModuleType('storage')
    _storage_pkg.__path__ = [str(_storage_dir)]
    _storage_pkg.__package__ = 'storage'
    sys.modules['storage'] = _storage_pkg

# Load models module first (key_store depends on it)
_models_path = _storage_dir / 'models.py'
_models_spec = importlib.util.spec_from_file_location("storage.models", _models_path, submodule_search_locations=[str(_storage_dir)])
_models_module = importlib.util.module_from_spec(_models_spec)
_models_module.__package__ = 'storage'
sys.modules['storage.models'] = _models_module
_models_spec.loader.exec_module(_models_module)
ClientAccount = _models_module.ClientAccount
TradeAuditLog = _models_module.TradeAuditLog
SystemMetrics = _models_module.SystemMetrics
DeduplicationCache = _models_module.DeduplicationCache

# Load key_store module (depends on models)
_key_store_path = _storage_dir / 'key_store.py'
_key_store_spec = importlib.util.spec_from_file_location("storage.key_store", _key_store_path, submodule_search_locations=[str(_storage_dir)])
_key_store_module = importlib.util.module_from_spec(_key_store_spec)
_key_store_module.__package__ = 'storage'
sys.modules['storage.key_store'] = _key_store_module
_key_store_spec.loader.exec_module(_key_store_module)
KeyStore = _key_store_module.KeyStore

__all__ = [
    'KeyStore',
    'ClientAccount',
    'TradeAuditLog',
    'SystemMetrics',
    'DeduplicationCache',
]


"""
Test Connection Script
Verify connectivity to Alpaca APIs for master and client accounts.

Usage:
    python scripts/test_connection.py
"""
import asyncio
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from config.settings import settings
from storage.key_store import KeyStore
from monitoring.logging import configure_logging
from alpaca.trading.client import TradingClient
import structlog


logger = structlog.get_logger(__name__)


async def test_master_connection():
    """Test master account connection"""
    print("\n🔍 Testing Master Account Connection...")
    print(f"   Account ID: {settings.master_account_id}")
    print(f"   Environment: {'PRODUCTION' if settings.is_production else 'PAPER TRADING'}")
    
    try:
        client = TradingClient(
            api_key=settings.master_api_key,
            secret_key=settings.master_secret_key,
            paper=settings.use_paper_trading
        )
        
        account = client.get_account()
        
        print(f"   ✅ Connection successful!")
        print(f"   Account Status: {account.status}")
        print(f"   Equity: ${float(account.equity):,.2f}")
        print(f"   Cash: ${float(account.cash):,.2f}")
        print(f"   Buying Power: ${float(account.buying_power):,.2f}")
        
        return True
    
    except Exception as e:
        print(f"   ❌ Connection failed: {e}")
        logger.error("master_connection_failed", error=str(e), exc_info=True)
        return False


async def test_client_connections():
    """Test all client account connections"""
    print("\n🔍 Testing Client Account Connections...")
    
    # Initialize key store
    key_store = KeyStore()
    await key_store.initialize()
    
    try:
        clients = await key_store.get_all_active_clients()
        
        if not clients:
            print("   ⚠️  No active client accounts found")
            return True
        
        print(f"   Found {len(clients)} active client(s)")
        print()
        
        success_count = 0
        failure_count = 0
        
        for i, client_account in enumerate(clients, 1):
            account_id = client_account["account_id"]
            print(f"   [{i}/{len(clients)}] Testing {account_id}...", end=" ")
            
            try:
                client = TradingClient(
                    api_key=client_account["api_key"],
                    secret_key=client_account["secret_key"],
                    paper=settings.use_paper_trading
                )
                
                account = client.get_account()
                
                print(f"✅ OK (Equity: ${float(account.equity):,.2f})")
                success_count += 1
            
            except Exception as e:
                print(f"❌ FAILED ({str(e)[:50]})")
                logger.error(
                    "client_connection_failed",
                    account_id=account_id,
                    error=str(e)
                )
                failure_count += 1
        
        print()
        print(f"   Summary: {success_count} success, {failure_count} failed")
        
        return failure_count == 0
    
    except Exception as e:
        print(f"   ❌ Failed to test clients: {e}")
        logger.error("test_clients_error", error=str(e), exc_info=True)
        return False
    
    finally:
        await key_store.close()


async def main():
    """Main entry point"""
    configure_logging()
    
    print("=" * 80)
    print("🔌 TRADE COPIER CONNECTION TEST")
    print("=" * 80)
    
    # Test master account
    master_ok = await test_master_connection()
    
    # Test client accounts
    clients_ok = await test_client_connections()
    
    # Summary
    print("\n" + "=" * 80)
    if master_ok and clients_ok:
        print("✅ ALL TESTS PASSED - System ready to run")
        print("=" * 80)
        sys.exit(0)
    else:
        print("❌ SOME TESTS FAILED - Fix errors before running")
        print("=" * 80)
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())


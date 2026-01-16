"""
Add Client Account Script
Utility to add client accounts to the trade copier system.

Usage:
    python scripts/add_client.py \\
        --account-id ACCOUNT_ID \\
        --api-key API_KEY \\
        --secret-key SECRET_KEY \\
        --email user@example.com \\
        --name "Client Name"

Scaling Method:
    Uses equity-based scaling (proportional to account balance)
    client_qty = master_qty × (client_equity / master_equity)
"""
import asyncio
import argparse
import sys
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from config.settings import settings
from storage.key_store import KeyStore
from monitoring.logging import configure_logging
import structlog


logger = structlog.get_logger(__name__)


async def add_client_account(
    account_id: str,
    api_key: str,
    secret_key: str,
    email: str = None,
    account_name: str = None
):
    """Add a client account to the system"""
    
    # Initialize key store
    key_store = KeyStore()
    await key_store.initialize()
    
    try:
        # Add account
        account = await key_store.add_client_account(
            account_id=account_id,
            api_key=api_key,
            secret_key=secret_key,
            email=email,
            account_name=account_name
        )
        
        logger.info(
            "client_account_added_successfully",
            account_id=account.account_id,
            account_name=account.account_name,
            scaling_method='equity_based'
        )
        
        print(f"\n✅ Client account added successfully!")
        print(f"   Account ID: {account.account_id}")
        print(f"   Name: {account.account_name or 'N/A'}")
        print(f"   Email: {account.email or 'N/A'}")
        print(f"   Scaling Method: equity_based (proportional to account balance)")
        print(f"   Status: {'Active' if account.is_active else 'Inactive'}")
        print(f"   Circuit Breaker: {account.circuit_breaker_state}")
        
    except Exception as e:
        logger.error("failed_to_add_client_account", error=str(e), exc_info=True)
        print(f"\n❌ Failed to add client account: {e}")
        sys.exit(1)
    
    finally:
        await key_store.close()


def main():
    """CLI entry point"""
    configure_logging()
    
    parser = argparse.ArgumentParser(
        description="Add a client account to the trade copier system"
    )
    
    parser.add_argument(
        "--account-id",
        required=True,
        help="Alpaca account ID"
    )
    
    parser.add_argument(
        "--api-key",
        required=True,
        help="Alpaca API key"
    )
    
    parser.add_argument(
        "--secret-key",
        required=True,
        help="Alpaca secret key"
    )
    
    parser.add_argument(
        "--email",
        help="Email address for notifications"
    )
    
    parser.add_argument(
        "--name",
        help="Friendly name for the account"
    )
    
    args = parser.parse_args()
    
    # Run async function
    asyncio.run(add_client_account(
        account_id=args.account_id,
        api_key=args.api_key,
        secret_key=args.secret_key,
        email=args.email,
        account_name=args.name
    ))


if __name__ == "__main__":
    main()


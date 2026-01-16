"""
List Client Accounts Script
Display all client accounts and their status.

Usage:
    python scripts/list_clients.py
    python scripts/list_clients.py --active-only
"""
import asyncio
import argparse
import sys
from pathlib import Path
from tabulate import tabulate

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from config.settings import settings
from storage.key_store import KeyStore
from storage.models import ClientAccount
from monitoring.logging import configure_logging
from sqlalchemy import select
import structlog


logger = structlog.get_logger(__name__)


async def list_clients(active_only: bool = False):
    """List all client accounts"""
    
    # Initialize key store
    key_store = KeyStore()
    await key_store.initialize()
    
    try:
        async with key_store.async_session() as session:
            # Build query
            stmt = select(ClientAccount)
            if active_only:
                stmt = stmt.where(ClientAccount.is_active == True)
            
            stmt = stmt.order_by(ClientAccount.created_at.desc())
            
            result = await session.execute(stmt)
            accounts = result.scalars().all()
            
            if not accounts:
                print("\nNo client accounts found.")
                return
            
            # Prepare table data
            table_data = []
            for account in accounts:
                table_data.append([
                    account.account_id,
                    account.account_name or "N/A",
                    account.email or "N/A",
                    "✅ Active" if account.is_active else "❌ Inactive",
                    account.circuit_breaker_state.upper(),
                    account.failure_count,
                    account.last_successful_trade.strftime("%Y-%m-%d %H:%M") if account.last_successful_trade else "Never"
                ])
            
            # Print table
            headers = [
                "Account ID",
                "Name",
                "Email",
                "Status",
                "Circuit Breaker",
                "Failures",
                "Last Trade"
            ]
            
            print(f"\n📊 Client Accounts ({len(accounts)} total)")
            print(f"Scaling Method: equity_based (proportional to account balance)")
            print("=" * 120)
            print(tabulate(table_data, headers=headers, tablefmt="grid"))
            print()
            
            # Summary statistics
            active_count = sum(1 for a in accounts if a.is_active)
            circuit_open_count = sum(1 for a in accounts if a.circuit_breaker_state == "open")
            
            print(f"Active: {active_count}/{len(accounts)}")
            print(f"Circuit Breakers Open: {circuit_open_count}")
            
    except Exception as e:
        logger.error("failed_to_list_clients", error=str(e), exc_info=True)
        print(f"\n❌ Failed to list clients: {e}")
        sys.exit(1)
    
    finally:
        await key_store.close()


def main():
    """CLI entry point"""
    configure_logging()
    
    parser = argparse.ArgumentParser(
        description="List client accounts in the trade copier system"
    )
    
    parser.add_argument(
        "--active-only",
        action="store_true",
        help="Show only active accounts"
    )
    
    args = parser.parse_args()
    
    asyncio.run(list_clients(active_only=args.active_only))


if __name__ == "__main__":
    main()


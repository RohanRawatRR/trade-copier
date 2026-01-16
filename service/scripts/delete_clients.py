#!/usr/bin/env python3
"""
Delete Client Accounts Script
Deletes one or more client accounts from the system.

Usage:
    python scripts/delete_clients.py CLIENT_ID1,CLIENT_ID2,...
"""
import asyncio
import sys
from pathlib import Path

# Add parent directory to path to import modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from storage.key_store import KeyStore
from monitoring.logging import configure_logging
import structlog

logger = structlog.get_logger(__name__)


async def delete_clients(client_ids_str: str):
    """Delete multiple client accounts"""
    # Configure logging
    configure_logging()
    
    # Parse client IDs
    client_ids = [cid.strip() for cid in client_ids_str.split(',') if cid.strip()]
    
    if not client_ids:
        print("\n❌ Error: No client IDs provided.")
        return

    # Initialize key store
    key_store = KeyStore()
    await key_store.initialize()
    
    print(f"\n🗑️  Starting deletion of {len(client_ids)} client(s)...\n")
    
    success_count = 0
    failure_count = 0
    
    for cid in client_ids:
        try:
            deleted = await key_store.delete_client_account(cid)
            if deleted:
                print(f"✅ Deleted: {cid}")
                success_count += 1
            else:
                print(f"⚠️  Not found: {cid}")
                failure_count += 1
        except Exception as e:
            print(f"❌ Failed to delete {cid}: {e}")
            logger.error("client_deletion_failed", account_id=cid, error=str(e))
            failure_count += 1
            
    await key_store.close()
    
    print("\n" + "=" * 40)
    print(f"📊 Deletion Summary")
    print("-" * 40)
    print(f"Successfully deleted: {success_count}")
    print(f"Failed/Not found:    {failure_count}")
    print("=" * 40 + "\n")


def main():
    """CLI entry point"""
    if len(sys.argv) < 2:
        print("\n❌ Error: Missing client IDs.")
        print("\nUsage:")
        print("    python scripts/delete_clients.py CLIENT_ID1,CLIENT_ID2,...")
        sys.exit(1)
    
    client_ids_arg = sys.argv[1]
    asyncio.run(delete_clients(client_ids_arg))


if __name__ == "__main__":
    main()


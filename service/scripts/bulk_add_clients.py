#!/usr/bin/env python3
"""
Bulk Add Clients from CSV
Imports multiple client accounts from a CSV file in one go.

CSV Format:
account_id,api_key,secret_key,account_name,email,is_active
PA3QAHQ1LPE4,AKXXX...,SKXXX...,John Doe,john@example.com,true
PA3BABUCRA93,AKYYY...,SKYYY...,Jane Smith,jane@example.com,true
PA3CLIENT001,AKZZZ...,SKZZZ...,Inactive Client,inactive@example.com,false

Scaling Method:
- Uses equity-based scaling (proportional to account balance)
- client_qty = master_qty × (client_equity / master_equity)
- Maintains same % of equity usage across all accounts

Fields:
- account_id: Required, unique identifier
- api_key: Required, Alpaca API key
- secret_key: Required, Alpaca secret key
- account_name: Optional, client's name
- email: Optional, client's email
- is_active: Optional (true/false), default: true
"""
import asyncio
import csv
import sys
from pathlib import Path
from typing import List, Dict, Optional
import structlog

# Add parent directory to path to import modules
sys.path.insert(0, str(Path(__file__).parent.parent))

from storage.key_store import KeyStore
from monitoring.logging import configure_logging

logger = structlog.get_logger(__name__)


class BulkClientImporter:
    """Handles bulk import of clients from CSV"""
    
    def __init__(self, key_store: KeyStore):
        self.key_store = key_store
        self.success_count = 0
        self.failure_count = 0
        self.skipped_count = 0
        self.errors: List[Dict] = []
    
    def validate_csv_headers(self, headers: List[str]) -> bool:
        """Validate CSV has required headers"""
        required_headers = {'account_id', 'api_key', 'secret_key'}
        optional_headers = {'account_name', 'email', 'is_active'}
        all_valid_headers = required_headers | optional_headers
        
        headers_set = set(h.strip().lower() for h in headers)
        
        # Check required headers
        missing = required_headers - headers_set
        if missing:
            logger.error(
                "csv_missing_required_headers",
                missing=list(missing),
                required=list(required_headers)
            )
            return False
        
        # Check for invalid headers
        invalid = headers_set - all_valid_headers
        if invalid:
            logger.warning(
                "csv_has_invalid_headers",
                invalid=list(invalid),
                note="These columns will be ignored"
            )
        
        return True
    
    def parse_row(self, row: Dict[str, str], row_num: int) -> Optional[Dict]:
        """Parse and validate a CSV row"""
        try:
            # Required fields
            account_id = row.get('account_id', '').strip()
            api_key = row.get('api_key', '').strip()
            secret_key = row.get('secret_key', '').strip()
            
            if not account_id or not api_key or not secret_key:
                self.errors.append({
                    'row': row_num,
                    'account_id': account_id or 'MISSING',
                    'error': 'Missing required field (account_id, api_key, or secret_key)'
                })
                return None
            
            # Optional fields
            account_name = row.get('account_name', '').strip() or None
            email = row.get('email', '').strip() or None
            
            # Parse is_active (optional field)
            is_active = True  # Default
            active_str = row.get('is_active', '').strip().lower()
            if active_str:
                if active_str in ['true', '1', 'yes', 'y']:
                    is_active = True
                elif active_str in ['false', '0', 'no', 'n']:
                    is_active = False
                else:
                    self.errors.append({
                        'row': row_num,
                        'account_id': account_id,
                        'error': f'Invalid is_active: {active_str}. Must be: true/false, yes/no, 1/0'
                    })
                    return None
            
            return {
                'account_id': account_id,
                'api_key': api_key,
                'secret_key': secret_key,
                'account_name': account_name,
                'email': email,
                'is_active': is_active
            }
        
        except Exception as e:
            self.errors.append({
                'row': row_num,
                'account_id': row.get('account_id', 'UNKNOWN'),
                'error': f'Unexpected error: {str(e)}'
            })
            return None
    
    async def add_client(self, client_data: Dict, row_num: int) -> bool:
        """Add a single client to database"""
        try:
            # Check if client already exists
            existing = await self.key_store.get_client_by_account_id(client_data['account_id'])
            if existing:
                logger.warning(
                    "client_already_exists",
                    account_id=client_data['account_id'],
                    row=row_num,
                    note="Skipping"
                )
                self.skipped_count += 1
                self.errors.append({
                    'row': row_num,
                    'account_id': client_data['account_id'],
                    'error': 'Client already exists (skipped)'
                })
                return False
            
            # Add client
            await self.key_store.add_client_account(
                account_id=client_data['account_id'],
                api_key=client_data['api_key'],
                secret_key=client_data['secret_key'],
                account_name=client_data.get('account_name'),
                email=client_data.get('email'),
                is_active=client_data.get('is_active', True)
            )
            
            logger.info(
                "client_added",
                account_id=client_data['account_id'],
                row=row_num,
                scaling_method='equity_based'
            )
            self.success_count += 1
            return True
        
        except Exception as e:
            logger.error(
                "client_add_failed",
                account_id=client_data['account_id'],
                row=row_num,
                error=str(e)
            )
            self.failure_count += 1
            self.errors.append({
                'row': row_num,
                'account_id': client_data['account_id'],
                'error': f'Database error: {str(e)}'
            })
            return False
    
    async def import_from_csv(self, csv_file: Path) -> bool:
        """Import all clients from CSV file"""
        if not csv_file.exists():
            logger.error("csv_file_not_found", file=str(csv_file))
            print(f"❌ Error: File not found: {csv_file}")
            return False
        
        logger.info("csv_import_started", file=str(csv_file))
        print(f"\n📂 Reading CSV file: {csv_file}")
        
        try:
            with open(csv_file, 'r', encoding='utf-8') as f:
                # Read CSV
                reader = csv.DictReader(f)
                
                # Validate headers
                if not reader.fieldnames:
                    print("❌ Error: CSV file is empty or has no headers")
                    return False
                
                # Normalize header names (lowercase, strip whitespace)
                normalized_headers = [h.strip().lower() for h in reader.fieldnames]
                
                if not self.validate_csv_headers(normalized_headers):
                    print("❌ Error: CSV has missing or invalid headers")
                    print(f"   Required headers: account_id, api_key, secret_key")
                    print(f"   Optional headers: account_name, email, is_active")
                    return False
                
                print("✅ CSV headers validated")
                print("\n🔄 Processing clients...\n")
                
                # Process each row
                row_num = 1  # Start at 1 (header is row 0)
                clients_to_add = []
                
                for row in reader:
                    row_num += 1
                    # Normalize keys
                    normalized_row = {k.strip().lower(): v for k, v in row.items()}
                    
                    # Skip empty rows
                    if not any(normalized_row.values()):
                        continue
                    
                    # Parse and validate
                    client_data = self.parse_row(normalized_row, row_num)
                    if client_data:
                        clients_to_add.append((client_data, row_num))
                
                if not clients_to_add:
                    print("❌ Error: No valid clients found in CSV")
                    return False
                
                print(f"📋 Found {len(clients_to_add)} clients to import\n")
                
                # Add clients to database
                for client_data, row_num in clients_to_add:
                    await self.add_client(client_data, row_num)
                
                # Print summary
                self.print_summary()
                
                return self.failure_count == 0
        
        except Exception as e:
            logger.error("csv_import_failed", error=str(e), exc_info=True)
            print(f"\n❌ Error reading CSV: {e}")
            return False
    
    def print_summary(self):
        """Print import summary"""
        print("\n" + "=" * 60)
        print("📊 IMPORT SUMMARY")
        print("=" * 60)
        print(f"✅ Successfully added: {self.success_count}")
        print(f"⏭️  Skipped (already exists): {self.skipped_count}")
        print(f"❌ Failed: {self.failure_count}")
        print(f"📝 Total processed: {self.success_count + self.skipped_count + self.failure_count}")
        
        if self.errors:
            print(f"\n⚠️  ERRORS ({len(self.errors)}):")
            print("-" * 60)
            for error in self.errors:
                print(f"  Row {error['row']}: {error['account_id']}")
                print(f"    → {error['error']}")
        
        print("=" * 60)
        
        if self.success_count > 0:
            print(f"\n✅ Successfully imported {self.success_count} client(s)!")
        
        if self.failure_count > 0:
            print(f"\n❌ {self.failure_count} client(s) failed to import. Check errors above.")


async def main():
    """Main entry point"""
    # Configure logging
    configure_logging()
    
    print("\n" + "=" * 60)
    print("🚀 BULK CLIENT IMPORT")
    print("=" * 60)
    
    # Check arguments
    if len(sys.argv) < 2:
        print("\n❌ Error: No CSV file specified")
        print("\nUsage:")
        print("  python scripts/bulk_add_clients.py <csv_file>")
        print("\nExample:")
        print("  python scripts/bulk_add_clients.py clients.csv")
        print("\nCSV Format:")
        print("  account_id,api_key,secret_key,account_name,email,is_active")
        print("  PA3QAHQ1LPE4,AKXXX...,SKXXX...,John Doe,john@example.com,true")
        print("  PA3BABUCRA93,AKYYY...,SKYYY...,Jane Smith,jane@example.com,true")
        print("\nScaling Method:")
        print("  Uses equity-based (proportional to account balance)")
        print("\nRequired fields: account_id, api_key, secret_key")
        print("Optional fields: account_name, email, is_active")
        sys.exit(1)
    
    csv_file = Path(sys.argv[1])
    
    # Create key store
    key_store = KeyStore()
    await key_store.initialize()
    
    # Import clients
    importer = BulkClientImporter(key_store)
    success = await importer.import_from_csv(csv_file)
    
    # Close database
    await key_store.close()
    
    # Exit with appropriate code
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    asyncio.run(main())


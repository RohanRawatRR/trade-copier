// API Route: /api/clients/bulk
// Handles bulk import of clients from CSV file

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { encryptApiKey } from '@/lib/encryption';

interface ClientRow {
  account_id: string;
  api_key: string;
  secret_key: string;
  account_name?: string;
  email?: string;
  is_active?: boolean;
}

interface ImportResult {
  success: number;
  skipped: number;
  failed: number;
  errors: Array<{
    row: number;
    account_id: string;
    error: string;
  }>;
}

function parseCSV(csvText: string): string[][] {
  const lines = csvText.split('\n').map(line => line.trim()).filter(line => line);
  const result: string[][] = [];
  
  for (const line of lines) {
    const row: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        row.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    row.push(current.trim());
    result.push(row);
  }
  
  return result;
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/\s+/g, '_');
}

function parseBoolean(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return ['true', '1', 'yes', 'y'].includes(normalized);
}

function validateHeaders(headers: string[]): { valid: boolean; missing?: string[] } {
  const normalizedHeaders = headers.map(normalizeHeader);
  const requiredHeaders = ['account_id', 'api_key', 'secret_key'];
  const missing = requiredHeaders.filter(h => !normalizedHeaders.includes(h));
  
  return {
    valid: missing.length === 0,
    missing: missing.length > 0 ? missing : undefined,
  };
}

function parseRow(
  row: string[],
  headers: string[],
  rowNum: number
): { valid: boolean; data?: ClientRow; error?: string } {
  const normalizedHeaders = headers.map(normalizeHeader);
  const rowData: Record<string, string> = {};
  
  // Map row values to headers
  for (let i = 0; i < headers.length && i < row.length; i++) {
    rowData[normalizedHeaders[i]] = row[i] || '';
  }
  
  // Extract required fields
  const account_id = rowData.account_id?.trim();
  const api_key = rowData.api_key?.trim();
  const secret_key = rowData.secret_key?.trim();
  
  // Validate required fields
  if (!account_id || !api_key || !secret_key) {
    return {
      valid: false,
      error: 'Missing required field (account_id, api_key, or secret_key)',
    };
  }
  
  // Extract optional fields
  const account_name = rowData.account_name?.trim() || undefined;
  const email = rowData.email?.trim() || undefined;
  
  // Parse is_active
  let is_active = true; // Default
  if (rowData.is_active) {
    const activeStr = rowData.is_active.trim().toLowerCase();
    if (activeStr && !['true', '1', 'yes', 'y', 'false', '0', 'no', 'n'].includes(activeStr)) {
      return {
        valid: false,
        error: `Invalid is_active value: ${rowData.is_active}. Must be: true/false, yes/no, 1/0`,
      };
    }
    is_active = parseBoolean(activeStr);
  }
  
  return {
    valid: true,
    data: {
      account_id,
      api_key,
      secret_key,
      account_name,
      email,
      is_active,
    },
  };
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    
    if (!file) {
      return NextResponse.json(
        {
          success: false,
          error: 'No file provided',
        },
        { status: 400 }
      );
    }
    
    // Read file content
    const csvText = await file.text();
    
    // Parse CSV
    const rows = parseCSV(csvText);
    
    if (rows.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'CSV file is empty',
        },
        { status: 400 }
      );
    }
    
    // First row should be headers
    const headers = rows[0];
    const dataRows = rows.slice(1);
    
    // Validate headers
    const headerValidation = validateHeaders(headers);
    if (!headerValidation.valid) {
      return NextResponse.json(
        {
          success: false,
          error: `Missing required headers: ${headerValidation.missing?.join(', ')}`,
          requiredHeaders: ['account_id', 'api_key', 'secret_key'],
          optionalHeaders: ['account_name', 'email', 'is_active'],
        },
        { status: 400 }
      );
    }
    
    // Process rows
    const result: ImportResult = {
      success: 0,
      skipped: 0,
      failed: 0,
      errors: [],
    };
    
    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const rowNum = i + 2; // +2 because header is row 1, and we're 0-indexed
      
      // Skip empty rows
      if (!row.some(cell => cell.trim())) {
        continue;
      }
      
      // Parse row
      const parsed = parseRow(row, headers, rowNum);
      
      if (!parsed.valid || !parsed.data) {
        result.failed++;
        result.errors.push({
          row: rowNum,
          account_id: row[0] || 'UNKNOWN',
          error: parsed.error || 'Invalid row data',
        });
        continue;
      }
      
      const clientData = parsed.data;
      
      try {
        // Check if client already exists
        const existing = await (prisma as any).clientAccount.findUnique({
          where: { account_id: clientData.account_id },
        });
        
        if (existing) {
          result.skipped++;
          result.errors.push({
            row: rowNum,
            account_id: clientData.account_id,
            error: 'Client already exists (skipped)',
          });
          continue;
        }
        
        // Encrypt API keys
        const encryptedApiKey = encryptApiKey(clientData.api_key);
        const encryptedSecretKey = encryptApiKey(clientData.secret_key);
        
        // Create client
        await (prisma as any).clientAccount.create({
          data: {
            account_id: clientData.account_id,
            account_name: clientData.account_name,
            email: clientData.email,
            encrypted_api_key: encryptedApiKey,
            encrypted_secret_key: encryptedSecretKey,
            is_active: clientData.is_active ?? true,
            circuit_breaker_state: 'closed',
            failure_count: 0,
            created_at: new Date(),
            updated_at: new Date(),
          },
        });
        
        result.success++;
      } catch (error: any) {
        result.failed++;
        result.errors.push({
          row: rowNum,
          account_id: clientData.account_id,
          error: `Database error: ${error.message}`,
        });
      }
    }
    
    return NextResponse.json({
      success: true,
      data: result,
      message: `Import completed: ${result.success} added, ${result.skipped} skipped, ${result.failed} failed`,
    });
  } catch (error: any) {
    console.error('Error processing bulk import:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to process CSV file',
        message: error.message,
      },
      { status: 500 }
    );
  }
}

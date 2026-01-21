// API Route: /api/clients/[id]
// Handle update and delete operations for a specific client

import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { encryptApiKey } from '@/lib/encryption';

/**
 * PATCH /api/clients/[id]
 * Update a client account
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const account_id = id; // Use account_id directly (string)
    const body = await request.json();
    const { account_name, email, api_key, secret_key, is_active } = body;

    // Check if client exists
    const existingClient = await prisma.clientAccount.findUnique({
      where: { account_id },
    });

    if (!existingClient) {
      return NextResponse.json(
        {
          success: false,
          error: 'Client not found',
        },
        { status: 404 }
      );
    }

    // Prepare update data
    const updateData: any = {};

    if (account_name !== undefined) updateData.account_name = account_name;
    if (email !== undefined) updateData.email = email;
    if (is_active !== undefined) updateData.is_active = is_active;

    // Encrypt new keys if provided
    if (api_key) updateData.encrypted_api_key = encryptApiKey(api_key);
    if (secret_key) updateData.encrypted_secret_key = encryptApiKey(secret_key);

    // Update client
    const updatedClient = await prisma.clientAccount.update({
      where: { account_id },
      data: updateData,
      select: {
        account_id: true,
        account_name: true,
        email: true,
        is_active: true,
        created_at: true,
        updated_at: true,
      },
    });

    return NextResponse.json({
      success: true,
      data: updatedClient,
      message: 'Client updated successfully',
    });
  } catch (error: any) {
    console.error('Error updating client:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update client',
        message: error.message,
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/clients/[id]
 * Delete a client account
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const account_id = id; // Use account_id directly (string)

    // Check if client exists
    const existingClient = await prisma.clientAccount.findUnique({
      where: { account_id },
    });

    if (!existingClient) {
      return NextResponse.json(
        {
          success: false,
          error: 'Client not found',
        },
        { status: 404 }
      );
    }

    // Delete client
    await prisma.clientAccount.delete({
      where: { account_id },
    });

    return NextResponse.json({
      success: true,
      message: 'Client deleted successfully',
    });
  } catch (error: any) {
    console.error('Error deleting client:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to delete client',
        message: error.message,
      },
      { status: 500 }
    );
  }
}


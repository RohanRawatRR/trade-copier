'use client';

// Client Management Page

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, Trash2, Edit } from 'lucide-react';
import { ClientAccount } from '@/types';
import { AppHeader } from '@/components/dashboard/app-header';
import { useToast } from '@/components/providers/toast-provider';

export default function ClientsPage() {
  const queryClient = useQueryClient();
  const { showSuccess, showError } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<ClientAccount | null>(null);
  const [formData, setFormData] = useState({
    account_id: '',
    account_name: '',
    email: '',
    api_key: '',
    secret_key: '',
    is_active: true,
  });

  // Fetch clients
  const { data, isLoading } = useQuery({
    queryKey: ['clients'],
    queryFn: async () => {
      const response = await fetch('/api/clients');
      if (!response.ok) throw new Error('Failed to fetch clients');
      return response.json();
    },
  });

  // Add client mutation
  const addClientMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await fetch('/api/clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to add client');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      setIsAddDialogOpen(false);
      resetForm();
      showSuccess('Client added successfully!', 'Success');
    },
    onError: (error: Error) => {
      showError(error.message || 'Failed to add client', 'Error');
    },
  });

  // Delete client mutation
  const deleteClientMutation = useMutation({
    mutationFn: async (account_id: string) => {
      const response = await fetch(`/api/clients/${account_id}`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete client');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      showSuccess('Client deleted successfully!', 'Success');
    },
    onError: (error: Error) => {
      showError(error.message || 'Failed to delete client', 'Error');
    },
  });

  // Update client mutation
  const updateClientMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const response = await fetch(`/api/clients/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) throw new Error('Failed to update client');
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      setEditingClient(null);
      resetForm();
      showSuccess('Client updated successfully!', 'Success');
    },
    onError: (error: Error) => {
      showError(error.message || 'Failed to update client', 'Error');
    },
  });

  const resetForm = () => {
    setFormData({
      account_id: '',
      account_name: '',
      email: '',
      api_key: '',
      secret_key: '',
      is_active: true,
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingClient) {
      updateClientMutation.mutate({ id: editingClient.account_id, data: formData });
    } else {
      addClientMutation.mutate(formData);
    }
  };

  const handleEdit = (client: any) => {
    setEditingClient(client);
    setFormData({
      account_id: client.account_id,
      account_name: client.account_name || '',
      email: client.email || '',
      api_key: '',
      secret_key: '',
      is_active: client.is_active,
    });
    setIsAddDialogOpen(true);
  };

  const handleDelete = (account_id: string) => {
    if (confirm('Are you sure you want to delete this client?')) {
      deleteClientMutation.mutate(account_id);
    }
  };

  const clients: ClientAccount[] = data?.data || [];

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        title="Client Management"
        description="Manage client accounts and API credentials"
      />

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Client Accounts ({clients.length})</CardTitle>
            <Button onClick={() => setIsAddDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Client
            </Button>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="text-center py-8">Loading...</div>
            ) : clients.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                No clients found. Add your first client to get started.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account ID</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {clients.map((client: any) => (
                    <TableRow key={client.account_id}>
                      <TableCell className="font-mono text-sm">
                        {client.account_id}
                      </TableCell>
                      <TableCell>{client.account_name || '-'}</TableCell>
                      <TableCell>{client.email || '-'}</TableCell>
                      <TableCell>
                        <Badge variant={client.is_active ? 'default' : 'secondary'}>
                          {client.is_active ? 'Active' : 'Inactive'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {/* Skip created_at if it causes datetime issues */}
                        {client.created_at ? (
                          (() => {
                            try {
                              return new Date(client.created_at).toLocaleDateString();
                            } catch {
                              return 'N/A';
                            }
                          })()
                        ) : 'N/A'}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleEdit(client)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={() => handleDelete(client.account_id)}
                            disabled={deleteClientMutation.isPending}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </main>

      {/* Add/Edit Client Dialog */}
      <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingClient ? 'Edit Client' : 'Add New Client'}
            </DialogTitle>
            <DialogDescription>
              {editingClient
                ? 'Update client account information'
                : 'Add a new client account to replicate trades'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit}>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="account_id">Account ID *</Label>
                <Input
                  id="account_id"
                  value={formData.account_id}
                  onChange={(e) =>
                    setFormData({ ...formData, account_id: e.target.value })
                  }
                  required
                  disabled={!!editingClient}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="account_name">Account Name</Label>
                <Input
                  id="account_name"
                  value={formData.account_name}
                  onChange={(e) =>
                    setFormData({ ...formData, account_name: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) =>
                    setFormData({ ...formData, email: e.target.value })
                  }
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="api_key">API Key *</Label>
                <Input
                  id="api_key"
                  type="password"
                  value={formData.api_key}
                  onChange={(e) =>
                    setFormData({ ...formData, api_key: e.target.value })
                  }
                  required={!editingClient}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="secret_key">Secret Key *</Label>
                <Input
                  id="secret_key"
                  type="password"
                  value={formData.secret_key}
                  onChange={(e) =>
                    setFormData({ ...formData, secret_key: e.target.value })
                  }
                  required={!editingClient}
                />
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="is_active"
                  checked={formData.is_active}
                  onChange={(e) =>
                    setFormData({ ...formData, is_active: e.target.checked })
                  }
                  className="h-4 w-4"
                />
                <Label htmlFor="is_active">Active</Label>
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsAddDialogOpen(false);
                  setEditingClient(null);
                  resetForm();
                }}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={
                  addClientMutation.isPending || updateClientMutation.isPending
                }
              >
                {editingClient ? 'Update' : 'Add'} Client
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}


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
import { Plus, Trash2, Edit, Upload, FileText, CheckCircle2, XCircle, AlertCircle, Download, TrendingUp, ArrowUpDown } from 'lucide-react';
import { ClientAccount } from '@/types';
import { AppHeader } from '@/components/dashboard/app-header';
import { useToast } from '@/components/providers/toast-provider';

export default function ClientsPage() {
  const queryClient = useQueryClient();
  const { showSuccess, showError } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isBulkUploadOpen, setIsBulkUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadResult, setUploadResult] = useState<any>(null);
  const [editingClient, setEditingClient] = useState<ClientAccount | null>(null);
  const [riskMultiplierClient, setRiskMultiplierClient] = useState<ClientAccount | null>(null);
  const [riskMultiplierValue, setRiskMultiplierValue] = useState<number>(1.0);
  const [tradeDirectionClient, setTradeDirectionClient] = useState<ClientAccount | null>(null);
  const [tradeDirectionValue, setTradeDirectionValue] = useState<string>('both');
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

  // Update trade direction mutation
  const updateTradeDirectionMutation = useMutation({
    mutationFn: async ({ accountId, tradeDirection }: { accountId: string; tradeDirection: string }) => {
      const response = await fetch(`/api/clients/${accountId}/trade-direction`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trade_direction: tradeDirection }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update trade direction');
      }
      return response.json();
    },
    onSuccess: async (data) => {
      await queryClient.invalidateQueries({ queryKey: ['clients'] });
      await queryClient.refetchQueries({ queryKey: ['clients'] });
      setTradeDirectionClient(null);
      showSuccess(
        `Trade direction updated to ${data.data.trade_direction}`,
        'Trade Direction Updated'
      );
    },
    onError: (error: Error) => {
      showError(error.message || 'Failed to update trade direction', 'Error');
    },
  });

  // Update risk multiplier mutation
  const updateRiskMultiplierMutation = useMutation({
    mutationFn: async ({ accountId, riskMultiplier }: { accountId: string; riskMultiplier: number }) => {
      const response = await fetch(`/api/clients/${accountId}/risk-multiplier`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ risk_multiplier: riskMultiplier }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update risk multiplier');
      }
      return response.json();
    },
    onSuccess: async (data) => {
      // Invalidate and refetch clients data
      await queryClient.invalidateQueries({ queryKey: ['clients'] });
      await queryClient.refetchQueries({ queryKey: ['clients'] });
      setRiskMultiplierClient(null);
      showSuccess(
        `Risk multiplier updated to ${data.data.risk_multiplier}x`,
        'Risk Multiplier Updated'
      );
    },
    onError: (error: Error) => {
      showError(error.message || 'Failed to update risk multiplier', 'Error');
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

  // Bulk upload mutation
  const bulkUploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      
      const response = await fetch('/api/clients/bulk', {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to upload clients');
      }
      
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['clients'] });
      setUploadResult(data.data);
      setUploadFile(null);
      const result = data.data;
      if (result.success > 0) {
        showSuccess(
          `Successfully imported ${result.success} client(s)`,
          'Bulk Import Complete'
        );
      }
      if (result.failed > 0) {
        showError(
          `${result.failed} client(s) failed to import. Check details below.`,
          'Import Errors'
        );
      }
    },
    onError: (error: Error) => {
      showError(error.message || 'Failed to upload clients', 'Upload Error');
      setUploadResult(null);
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

  const handleBulkUpload = () => {
    if (!uploadFile) {
      showError('Please select a CSV file', 'No File Selected');
      return;
    }
    
    bulkUploadMutation.mutate(uploadFile);
  };

  const handleDownloadTemplate = () => {
    // Create CSV content with headers and example rows
    const csvContent = [
      'account_id,api_key,secret_key,account_name,email,is_active',
      'PA3QAHQ1LPE4,AKXXX...,SKXXX...,John Doe,john@example.com,true',
      'PA3BABUCRA93,AKYYY...,SKYYY...,Jane Smith,jane@example.com,true',
    ].join('\n');

    // Create blob and download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', 'clients_template.csv');
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    URL.revokeObjectURL(url);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) {
        showError('Please select a CSV file', 'Invalid File Type');
        return;
      }
      setUploadFile(file);
      setUploadResult(null);
    }
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
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setIsBulkUploadOpen(true)}
              >
                <Upload className="mr-2 h-4 w-4" />
                Bulk Upload
              </Button>
            <Button onClick={() => setIsAddDialogOpen(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Add Client
            </Button>
            </div>
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
                    <TableHead>Direction</TableHead>
                    <TableHead>Risk</TableHead>
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
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setTradeDirectionClient(client);
                            setTradeDirectionValue(client.trade_direction || 'both');
                          }}
                          className="h-8 gap-1"
                        >
                          <ArrowUpDown className="h-3 w-3" />
                          {client.trade_direction === 'long' ? 'Long' : client.trade_direction === 'short' ? 'Short' : 'Both'}
                        </Button>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setRiskMultiplierClient(client);
                            setRiskMultiplierValue(client.risk_multiplier || 1.0);
                          }}
                          className="h-8 gap-1"
                        >
                          <TrendingUp className="h-3 w-3" />
                          {(client.risk_multiplier || 1.0).toFixed(1)}x
                        </Button>
                      </TableCell>
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

      {/* Bulk Upload Dialog */}
      <Dialog open={isBulkUploadOpen} onOpenChange={setIsBulkUploadOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Bulk Upload Clients</DialogTitle>
            <DialogDescription>
              Upload a CSV file to import multiple clients at once
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            {/* CSV Format Info */}
            <div className="bg-muted/50 p-4 rounded-lg">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-start gap-2 flex-1">
                  <FileText className="h-5 w-5 text-muted-foreground mt-0.5" />
                  <div>
                    <p className="font-semibold text-sm mb-1">CSV Format:</p>
                    <p className="text-xs text-muted-foreground mb-2">
                      Required columns: <code className="bg-background px-1 py-0.5 rounded">account_id</code>,{' '}
                      <code className="bg-background px-1 py-0.5 rounded">api_key</code>,{' '}
                      <code className="bg-background px-1 py-0.5 rounded">secret_key</code>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Optional columns: <code className="bg-background px-1 py-0.5 rounded">account_name</code>,{' '}
                      <code className="bg-background px-1 py-0.5 rounded">email</code>,{' '}
                      <code className="bg-background px-1 py-0.5 rounded">is_active</code>
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleDownloadTemplate}
                  className="flex-shrink-0"
                >
                  <Download className="mr-2 h-4 w-4" />
                  Download Template
                </Button>
              </div>
            </div>

            {/* File Input */}
            <div className="space-y-2">
              <Label htmlFor="csv-file">CSV File</Label>
              <Input
                id="csv-file"
                type="file"
                accept=".csv"
                onChange={handleFileChange}
                disabled={bulkUploadMutation.isPending}
              />
              {uploadFile && (
                <p className="text-sm text-muted-foreground">
                  Selected: {uploadFile.name} ({(uploadFile.size / 1024).toFixed(2)} KB)
                </p>
              )}
            </div>

            {/* Upload Results */}
            {uploadResult && (
              <div className="space-y-3 border-t pt-4">
                <div className="flex items-center gap-2">
                  <h4 className="font-semibold">Import Results</h4>
                </div>
                
                <div className="grid grid-cols-3 gap-4">
                  <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-950/20 rounded-lg">
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                    <div>
                      <p className="text-2xl font-bold text-green-600">{uploadResult.success}</p>
                      <p className="text-xs text-muted-foreground">Success</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 p-3 bg-yellow-50 dark:bg-yellow-950/20 rounded-lg">
                    <AlertCircle className="h-5 w-5 text-yellow-600" />
                    <div>
                      <p className="text-2xl font-bold text-yellow-600">{uploadResult.skipped}</p>
                      <p className="text-xs text-muted-foreground">Skipped</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-950/20 rounded-lg">
                    <XCircle className="h-5 w-5 text-red-600" />
                    <div>
                      <p className="text-2xl font-bold text-red-600">{uploadResult.failed}</p>
                      <p className="text-xs text-muted-foreground">Failed</p>
                    </div>
                  </div>
                </div>

                {/* Errors List */}
                {uploadResult.errors && uploadResult.errors.length > 0 && (
                  <div className="mt-4">
                    <p className="text-sm font-semibold mb-2">Errors:</p>
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {uploadResult.errors.map((error: any, index: number) => (
                        <div
                          key={index}
                          className="text-xs p-2 bg-red-50 dark:bg-red-950/20 rounded border border-red-200 dark:border-red-800"
                        >
                          <span className="font-mono font-semibold">Row {error.row}</span> ({error.account_id}):{' '}
                          <span className="text-muted-foreground">{error.error}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setIsBulkUploadOpen(false);
                setUploadFile(null);
                setUploadResult(null);
              }}
              disabled={bulkUploadMutation.isPending}
            >
              Close
            </Button>
            <Button
              type="button"
              onClick={handleBulkUpload}
              disabled={!uploadFile || bulkUploadMutation.isPending}
            >
              {bulkUploadMutation.isPending ? (
                <>
                  <Upload className="mr-2 h-4 w-4 animate-pulse" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Upload
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Risk Multiplier Dialog */}
      <Dialog open={!!riskMultiplierClient} onOpenChange={(open) => !open && setRiskMultiplierClient(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Adjust Risk Multiplier</DialogTitle>
            <DialogDescription>
              Control position sizing for {riskMultiplierClient?.account_name || riskMultiplierClient?.account_id}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            {/* Risk Multiplier Slider */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="risk-multiplier" className="text-base font-semibold">
                  Risk Multiplier
                </Label>
                <div className="flex items-center gap-2">
                  <Input
                    id="risk-multiplier-input"
                    type="number"
                    step="0.1"
                    min="0.1"
                    max="3.0"
                    value={riskMultiplierValue}
                    onChange={(e) => setRiskMultiplierValue(parseFloat(e.target.value) || 1.0)}
                    className="w-20 text-center font-bold"
                  />
                  <span className="text-sm font-medium">x</span>
                </div>
              </div>
              
              <input
                id="risk-multiplier"
                type="range"
                min="0.1"
                max="3.0"
                step="0.1"
                value={riskMultiplierValue}
                onChange={(e) => setRiskMultiplierValue(parseFloat(e.target.value))}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer dark:bg-gray-700"
              />
              
              {/* Quick Presets */}
              <div className="flex gap-2 flex-wrap">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setRiskMultiplierValue(0.5)}
                >
                  0.5x (Conservative)
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setRiskMultiplierValue(1.0)}
                >
                  1.0x (Normal)
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setRiskMultiplierValue(1.5)}
                >
                  1.5x (Aggressive)
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setRiskMultiplierValue(2.0)}
                >
                  2.0x (2x Leverage)
                </Button>
              </div>
            </div>

            {/* Explanation */}
            <div className="bg-muted p-4 rounded-lg space-y-2">
              <p className="text-sm font-medium">How it works:</p>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• <strong>1.0x</strong> = Normal (100% of equity-based calculation)</li>
                <li>• <strong>0.5x</strong> = Conservative (50% of equity)</li>
                <li>• <strong>1.5x</strong> = Aggressive (150% of equity, using margin)</li>
              </ul>
              <p className="text-xs text-muted-foreground mt-2">
                Example: If master uses 10% of equity, and you set 0.5x, client will use 5% of equity.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRiskMultiplierClient(null)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (riskMultiplierClient) {
                  updateRiskMultiplierMutation.mutate({
                    accountId: riskMultiplierClient.account_id,
                    riskMultiplier: riskMultiplierValue,
                  });
                }
              }}
              disabled={updateRiskMultiplierMutation.isPending}
            >
              {updateRiskMultiplierMutation.isPending ? 'Updating...' : 'Update Risk Multiplier'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Trade Direction Dialog */}
      <Dialog open={!!tradeDirectionClient} onOpenChange={(open) => !open && setTradeDirectionClient(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Trade Direction Filter</DialogTitle>
            <DialogDescription>
              Choose which trades to replicate for {tradeDirectionClient?.account_name || tradeDirectionClient?.account_id}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-6 py-4">
            {/* Trade Direction Options */}
            <div className="space-y-4">
              <Label className="text-base font-semibold">Select Trade Direction</Label>
              
              <div className="grid gap-3">
                {/* Both Option */}
                <button
                  type="button"
                  onClick={() => setTradeDirectionValue('both')}
                  className={`flex items-start gap-3 p-4 rounded-lg border-2 transition-all ${
                    tradeDirectionValue === 'both'
                      ? 'border-primary bg-primary/5'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  <div className={`mt-0.5 h-5 w-5 rounded-full border-2 flex items-center justify-center ${
                    tradeDirectionValue === 'both' ? 'border-primary' : 'border-gray-300'
                  }`}>
                    {tradeDirectionValue === 'both' && (
                      <div className="h-2.5 w-2.5 rounded-full bg-primary" />
                    )}
                  </div>
                  <div className="flex-1 text-left">
                    <div className="font-semibold">Both (Long & Short)</div>
                    <div className="text-sm text-muted-foreground">
                      Replicate all trades - both long and short positions
                    </div>
                  </div>
                </button>

                {/* Long Only Option */}
                <button
                  type="button"
                  onClick={() => setTradeDirectionValue('long')}
                  className={`flex items-start gap-3 p-4 rounded-lg border-2 transition-all ${
                    tradeDirectionValue === 'long'
                      ? 'border-green-500 bg-green-500/5'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  <div className={`mt-0.5 h-5 w-5 rounded-full border-2 flex items-center justify-center ${
                    tradeDirectionValue === 'long' ? 'border-green-500' : 'border-gray-300'
                  }`}>
                    {tradeDirectionValue === 'long' && (
                      <div className="h-2.5 w-2.5 rounded-full bg-green-500" />
                    )}
                  </div>
                  <div className="flex-1 text-left">
                    <div className="font-semibold text-green-600 dark:text-green-400">Long Only</div>
                    <div className="text-sm text-muted-foreground">
                      Only replicate long positions (buy to open, sell to close)
                    </div>
                  </div>
                </button>

                {/* Short Only Option */}
                <button
                  type="button"
                  onClick={() => setTradeDirectionValue('short')}
                  className={`flex items-start gap-3 p-4 rounded-lg border-2 transition-all ${
                    tradeDirectionValue === 'short'
                      ? 'border-red-500 bg-red-500/5'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                  }`}
                >
                  <div className={`mt-0.5 h-5 w-5 rounded-full border-2 flex items-center justify-center ${
                    tradeDirectionValue === 'short' ? 'border-red-500' : 'border-gray-300'
                  }`}>
                    {tradeDirectionValue === 'short' && (
                      <div className="h-2.5 w-2.5 rounded-full bg-red-500" />
                    )}
                  </div>
                  <div className="flex-1 text-left">
                    <div className="font-semibold text-red-600 dark:text-red-400">Short Only</div>
                    <div className="text-sm text-muted-foreground">
                      Only replicate short positions (sell to open, buy to close)
                    </div>
                  </div>
                </button>
              </div>
            </div>

            {/* Info Box */}
            <div className="bg-muted p-4 rounded-lg space-y-2">
              <p className="text-sm font-medium">How it works:</p>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• <strong>Both:</strong> Replicates all master trades (default)</li>
                <li>• <strong>Long Only:</strong> Skips short trades, only follows long positions</li>
                <li>• <strong>Short Only:</strong> Skips long trades, only follows short positions</li>
              </ul>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setTradeDirectionClient(null)}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (tradeDirectionClient) {
                  updateTradeDirectionMutation.mutate({
                    accountId: tradeDirectionClient.account_id,
                    tradeDirection: tradeDirectionValue,
                  });
                }
              }}
              disabled={updateTradeDirectionMutation.isPending}
            >
              {updateTradeDirectionMutation.isPending ? 'Updating...' : 'Update Trade Direction'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}


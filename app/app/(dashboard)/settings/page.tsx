'use client';

// Settings Page - Master Account Management

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Save, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { AppHeader } from '@/components/dashboard/app-header';
import { useToast } from '@/components/providers/toast-provider';

export default function SettingsPage() {
  const queryClient = useQueryClient();
  const { showSuccess, showError } = useToast();
  const [formData, setFormData] = useState({
    account_id: '',
    api_key: '',
    secret_key: '',
  });
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);

  // Fetch master account
  const { data: masterData, isLoading } = useQuery({
    queryKey: ['master-account'],
    queryFn: async () => {
      const response = await fetch('/api/master');
      if (!response.ok) {
        if (response.status === 404) return { data: null };
        throw new Error('Failed to fetch master account');
      }
      return response.json();
    },
  });

  const masterAccount = masterData?.data;

  // Update master account mutation
  const updateMasterMutation = useMutation({
    mutationFn: async (data: any) => {
      const response = await fetch('/api/master', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update master account');
      }
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['master-account'] });
      setResult({ success: true, message: data.message || 'Master account updated successfully!' });
      setFormData({ account_id: '', api_key: '', secret_key: '' });
      showSuccess(data.message || 'Master account updated successfully!', 'Success');
    },
    onError: (error: any) => {
      const errorMessage = error.message || 'Failed to update master account';
      setResult({ success: false, message: errorMessage });
      showError(errorMessage, 'Error');
    },
  });

  // Delete master account mutation
  const deleteMasterMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/master', {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('Failed to delete master account');
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['master-account'] });
      setResult({ success: true, message: data.message || 'Master account deleted successfully!' });
      showSuccess(data.message || 'Master account deleted successfully!', 'Success');
    },
    onError: (error: any) => {
      const errorMessage = error.message || 'Failed to delete master account';
      setResult({ success: false, message: errorMessage });
      showError(errorMessage, 'Error');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setResult(null);

    if (!formData.account_id || !formData.api_key || !formData.secret_key) {
      const errorMessage = 'All fields are required';
      setResult({ success: false, message: errorMessage });
      showError(errorMessage, 'Validation Error');
      return;
    }

    updateMasterMutation.mutate(formData);
  };

  const handleDelete = () => {
    if (confirm('Are you sure you want to delete the master account? This will stop all trade replication.')) {
      deleteMasterMutation.mutate();
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <AppHeader
        title="Settings"
        description="Manage master account configuration"
      />

      {/* Main Content */}
      <main className="container mx-auto px-4 py-8 max-w-2xl">
        {/* Current Master Account */}
        {isLoading ? (
          <Card className="mb-8">
            <CardContent className="py-8">
              <div className="text-center text-muted-foreground">Loading...</div>
            </CardContent>
          </Card>
        ) : masterAccount ? (
          <Card className="mb-8">
            <CardHeader>
              <CardTitle>Current Master Account</CardTitle>
              <CardDescription>
                The master account whose trades are being copied
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <div className="text-sm text-muted-foreground">Account ID</div>
                  <div className="font-mono font-semibold">{masterAccount.account_id}</div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Status</div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    <span className="font-semibold">Active</span>
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Created</div>
                  <div>{new Date(masterAccount.created_at).toLocaleString()}</div>
                </div>
                <div className="pt-4">
                  <Button
                    variant="destructive"
                    onClick={handleDelete}
                    disabled={deleteMasterMutation.isPending}
                  >
                    Delete Master Account
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Alert className="mb-8">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              No master account configured. Add one below to start copying trades.
            </AlertDescription>
          </Alert>
        )}

        {/* Update/Add Master Account Form */}
        <Card>
          <CardHeader>
            <CardTitle>
              {masterAccount ? 'Update Master Account' : 'Add Master Account'}
            </CardTitle>
            <CardDescription>
              {masterAccount
                ? 'Replace the current master account with new credentials'
                : 'Configure the account to copy trades from'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="account_id">Alpaca Account ID *</Label>
                <Input
                  id="account_id"
                  placeholder="PA3XXXXXXXXX"
                  value={formData.account_id}
                  onChange={(e) =>
                    setFormData({ ...formData, account_id: e.target.value })
                  }
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="api_key">API Key *</Label>
                <Input
                  id="api_key"
                  type="password"
                  placeholder="PK..."
                  value={formData.api_key}
                  onChange={(e) =>
                    setFormData({ ...formData, api_key: e.target.value })
                  }
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="secret_key">Secret Key *</Label>
                <Input
                  id="secret_key"
                  type="password"
                  placeholder="Your secret key"
                  value={formData.secret_key}
                  onChange={(e) =>
                    setFormData({ ...formData, secret_key: e.target.value })
                  }
                  required
                />
              </div>

              {result && (
                <Alert variant={result.success ? 'default' : 'destructive'}>
                  <AlertDescription>{result.message}</AlertDescription>
                </Alert>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={updateMasterMutation.isPending}
              >
                <Save className="mr-2 h-4 w-4" />
                {updateMasterMutation.isPending
                  ? 'Saving...'
                  : masterAccount
                  ? 'Update Master Account'
                  : 'Add Master Account'}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Important Note */}
        <Alert className="mt-8">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>Important:</strong> After updating the master account, It takes ~30 seconds to restart the
            Python trade copier service for changes to take effect.
          </AlertDescription>
        </Alert>
      </main>
    </div>
  );
}

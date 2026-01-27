'use client';

// Settings Page - Master Account Management

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Save, AlertTriangle, CheckCircle2, RefreshCw, XCircle, Loader2 } from 'lucide-react';
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

  // Fetch service status
  const { data: serviceStatus, isLoading: isStatusLoading, refetch: refetchStatus, error: statusError } = useQuery({
    queryKey: ['service-status'],
    queryFn: async () => {
      const response = await fetch('/api/service/restart');
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to fetch service status');
      }
      return response.json();
    },
    refetchInterval: 10000, // Auto-refresh every 10 seconds
    retry: false, // Don't retry on error (e.g., if SSH not configured)
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

  // Restart service mutation
  const restartServiceMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch('/api/service/restart', {
        method: 'POST',
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to restart service');
      }
      return response.json();
    },
    onSuccess: (data) => {
      setResult({ success: true, message: data.message || 'Service restarted successfully!' });
      showSuccess(data.message || 'Service restarted successfully!', 'Success');
      // Refresh service status after restart
      refetchStatus();
    },
    onError: (error: any) => {
      const errorMessage = error.message || 'Failed to restart service';
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
                  <div className="text-sm text-muted-foreground">Service Status</div>
                  <div className="flex items-center gap-2">
                    {isStatusLoading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        <span className="text-muted-foreground">Checking...</span>
                      </>
                    ) : statusError ? (
                      <>
                        <AlertTriangle className="h-4 w-4 text-yellow-500" />
                        <span className="font-semibold text-yellow-600">Unavailable</span>
                      </>
                    ) : serviceStatus?.status === 'active' ? (
                      <>
                        <CheckCircle2 className="h-4 w-4 text-green-500" />
                        <span className="font-semibold text-green-600">Running</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="h-4 w-4 text-red-500" />
                        <span className="font-semibold text-red-600">
                          {serviceStatus?.status === 'inactive' ? 'Stopped' : 'Unknown'}
                        </span>
                      </>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => refetchStatus()}
                      disabled={isStatusLoading}
                      className="ml-auto h-6 px-2"
                    >
                      <RefreshCw className={`h-3 w-3 ${isStatusLoading ? 'animate-spin' : ''}`} />
                    </Button>
                  </div>
                </div>
                <div>
                  <div className="text-sm text-muted-foreground">Created</div>
                  <div>{new Date(masterAccount.created_at).toLocaleString()}</div>
                </div>
                <div className="pt-4 flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => restartServiceMutation.mutate()}
                    disabled={restartServiceMutation.isPending}
                  >
                    <RefreshCw className={`mr-2 h-4 w-4 ${restartServiceMutation.isPending ? 'animate-spin' : ''}`} />
                    {restartServiceMutation.isPending ? 'Restarting...' : 'Restart Service'}
                  </Button>
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

        {/* Service Management */}
        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Service Management</CardTitle>
            <CardDescription>
              Monitor and manage the trade copier service status
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {/* Service Status Display */}
              <div className="flex items-center justify-between p-4 border rounded-lg bg-muted/50">
                <div className="flex items-center gap-3">
                  <div>
                    <div className="text-sm text-muted-foreground">Service Status</div>
                    <div className="flex items-center gap-2 mt-1">
                      {isStatusLoading ? (
                        <>
                          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                          <span className="font-semibold text-muted-foreground">Checking...</span>
                        </>
                      ) : statusError ? (
                        <>
                          <AlertTriangle className="h-5 w-5 text-yellow-500" />
                          <span className="font-semibold text-yellow-600">Unavailable</span>
                          <span className="text-xs text-muted-foreground ml-2">
                            ({statusError instanceof Error ? statusError.message : 'Check SSH config'})
                          </span>
                        </>
                      ) : serviceStatus?.status === 'active' ? (
                        <>
                          <CheckCircle2 className="h-5 w-5 text-green-500" />
                          <span className="font-semibold text-green-600">Running</span>
                        </>
                      ) : (
                        <>
                          <XCircle className="h-5 w-5 text-red-500" />
                          <span className="font-semibold text-red-600">
                            {serviceStatus?.status === 'inactive' ? 'Stopped' : 'Unknown'}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => refetchStatus()}
                  disabled={isStatusLoading}
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${isStatusLoading ? 'animate-spin' : ''}`} />
                  Refresh
                </Button>
              </div>

              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <strong>Important:</strong> After updating the master account credentials, you must restart the
                  Python trade copier service for changes to take effect.
                </AlertDescription>
              </Alert>
              
              <Button
                variant="outline"
                onClick={() => restartServiceMutation.mutate()}
                disabled={restartServiceMutation.isPending}
                className="w-full"
              >
                <RefreshCw className={`mr-2 h-4 w-4 ${restartServiceMutation.isPending ? 'animate-spin' : ''}`} />
                {restartServiceMutation.isPending ? 'Restarting Service...' : 'Restart Trade Copier Service'}
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}


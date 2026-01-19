'use client';

// Emergency Stop Button - Cancel all open orders

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, Loader2 } from 'lucide-react';

export function EmergencyStopButton() {
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [result, setResult] = useState<any>(null);

  const handleEmergencyStop = async () => {
    if (!confirmed) {
      alert('Please confirm that you understand this action');
      return;
    }

    setIsLoading(true);
    setResult(null);

    try {
      const response = await fetch('/api/emergency/close-all', {
        method: 'POST',
      });

      const data = await response.json();

      if (data.success) {
        setResult({
          success: true,
          message: data.message,
          data: data.data,
        });
      } else {
        setResult({
          success: false,
          message: data.error || 'Emergency cancellation failed',
        });
      }
    } catch (error: any) {
      setResult({
        success: false,
        message: error.message || 'Network error',
      });
    } finally {
      setIsLoading(false);
      setConfirmed(false);
    }
  };

  const handleClose = () => {
    setIsOpen(false);
    setConfirmed(false);
    setResult(null);
  };

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive" size="lg" className="w-full">
          <AlertTriangle className="mr-2 h-5 w-5" />
          Emergency: Close All Orders
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-red-500" />
            Emergency Order Cancellation
          </DialogTitle>
          <DialogDescription>
            This will cancel <strong>all open orders</strong> across <strong>all client accounts</strong>.
            This action cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>Warning:</strong> This is a critical operation that will immediately cancel
            all pending orders. Use this only in emergencies or when you need to stop all trading
            activity immediately.
          </AlertDescription>
        </Alert>

        <div className="flex items-center space-x-2 py-4">
          <input
            type="checkbox"
            id="confirm"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="h-4 w-4"
          />
          <label htmlFor="confirm" className="text-sm font-medium">
            I understand this action cannot be undone
          </label>
        </div>

        {result && (
          <Alert variant={result.success ? 'default' : 'destructive'}>
            <AlertDescription>
              <div className="font-semibold">{result.message}</div>
              {result.data && (
                <div className="mt-2 text-xs">
                  <div>Total clients: {result.data.total}</div>
                  <div>Successfully cancelled: {result.data.cancelled}</div>
                  <div>Failed: {result.data.failed}</div>
                </div>
              )}
            </AlertDescription>
          </Alert>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isLoading}>
            {result ? 'Close' : 'Cancel'}
          </Button>
          {!result && (
            <Button
              variant="destructive"
              onClick={handleEmergencyStop}
              disabled={!confirmed || isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Cancelling Orders...
                </>
              ) : (
                'Cancel All Orders'
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}


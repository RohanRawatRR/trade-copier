'use client';

// Client Balances Table - Shows live account balances

import { useQuery } from '@tanstack/react-query';
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
import { AccountBalance } from '@/types';
import { DollarSign, TrendingUp } from 'lucide-react';

export function ClientBalancesTable() {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['account-balances'],
    queryFn: async () => {
      const response = await fetch('/api/accounts/balances');
      if (!response.ok) throw new Error('Failed to fetch balances');
      return response.json();
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const balances: AccountBalance[] = data?.data?.clients || [];
  const masterBalance = data?.data?.master;

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(value);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Client Account Balances</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-muted-foreground py-8">Loading balances...</div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Client Account Balances</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center text-red-500 py-8">
            Failed to load balances
            <button
              onClick={() => refetch()}
              className="block mx-auto mt-2 text-sm underline"
            >
              Retry
            </button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Client Account Balances</CardTitle>
        <button
          onClick={() => refetch()}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Refresh
        </button>
      </CardHeader>
      <CardContent>
        {/* Master Account Summary */}
        {masterBalance && (
          <div className="mb-6 p-4 bg-primary/10 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="h-5 w-5" />
              <h3 className="font-semibold">Master Account</h3>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <div className="text-xs text-muted-foreground">Account ID</div>
                <div className="font-mono text-sm">{masterBalance.account_id}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Equity</div>
                <div className="font-semibold">{formatCurrency(masterBalance.equity)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Cash</div>
                <div className="font-semibold">{formatCurrency(masterBalance.cash)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Buying Power</div>
                <div className="font-semibold">{formatCurrency(masterBalance.buying_power)}</div>
              </div>
            </div>
          </div>
        )}

        {/* Client Accounts Table */}
        {balances.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            No client accounts found
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead className="text-right">Equity</TableHead>
                <TableHead className="text-right">Cash</TableHead>
                <TableHead className="text-right">Buying Power</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {balances.map((balance) => (
                <TableRow key={balance.account_id}>
                  <TableCell>
                    <div>
                      <div className="font-mono text-sm">{balance.account_id}</div>
                      {balance.account_name && (
                        <div className="text-xs text-muted-foreground">
                          {balance.account_name}
                        </div>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    {formatCurrency(balance.equity)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(balance.cash)}
                  </TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(balance.buying_power)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={balance.status === 'success' ? 'default' : 'destructive'}>
                      {balance.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}


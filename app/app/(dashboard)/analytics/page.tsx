'use client';

// Analytics Page - Advanced equity chart with filters and controls

import { useState } from 'react';
import { AppHeader } from '@/components/dashboard/app-header';
import { EquityAnalyticsChart } from '@/components/dashboard/equity-analytics-chart';

export default function AnalyticsPage() {
  return (
    <div className="min-h-screen bg-background">
      <AppHeader 
        title="Analytics" 
        description="Track equity growth and performance across accounts"
      />
      <main className="container mx-auto px-4 py-6">
        <EquityAnalyticsChart />
      </main>
    </div>
  );
}

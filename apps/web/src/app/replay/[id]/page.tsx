import React, { Suspense } from 'react';
import ReplayClient from './ReplayClient';
import { RouteIdProvider } from '@/lib/route-id';

export function generateStaticParams() {
  return [{ id: 'demo' }];
}

export default function ReplayPage() {
  return (
    <Suspense fallback={null}>
      <RouteIdProvider segment="replay">
        <ReplayClient />
      </RouteIdProvider>
    </Suspense>
  );
}

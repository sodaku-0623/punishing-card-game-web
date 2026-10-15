import React, { Suspense } from 'react';
import CardDetailClient from './CardDetailClient';
import { RouteIdProvider } from '@/lib/route-id';

export function generateStaticParams() {
  return [{ id: 'BP01-001' }];
}

export default function CardDetailPage() {
  return (
    <Suspense fallback={null}>
      <RouteIdProvider segment="cards">
        <CardDetailClient />
      </RouteIdProvider>
    </Suspense>
  );
}

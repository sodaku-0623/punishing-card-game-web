import React, { Suspense } from 'react';
import DeckDetailClient from './DeckDetailClient';
import { RouteIdProvider } from '@/lib/route-id';

export function generateStaticParams() {
  return [{ id: 'default' }];
}

export default function DeckDetailPage() {
  return (
    <Suspense fallback={null}>
      <RouteIdProvider segment="decks">
        <DeckDetailClient />
      </RouteIdProvider>
    </Suspense>
  );
}

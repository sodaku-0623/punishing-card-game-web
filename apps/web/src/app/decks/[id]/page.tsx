import React, { Suspense } from 'react';
import DeckDetailClient from './DeckDetailClient';

export function generateStaticParams() {
  return [{ id: 'default' }];
}

export default function DeckDetailPage() {
  return (
    <Suspense fallback={null}>
      <DeckDetailClient />
    </Suspense>
  );
}

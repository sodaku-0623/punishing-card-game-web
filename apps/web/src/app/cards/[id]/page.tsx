import React, { Suspense } from 'react';
import CardDetailClient from './CardDetailClient';

export function generateStaticParams() {
  return [{ id: 'BP01-001' }];
}

export default function CardDetailPage() {
  return (
    <Suspense fallback={null}>
      <CardDetailClient />
    </Suspense>
  );
}

import React, { Suspense } from 'react';
import ReplayClient from './ReplayClient';

export function generateStaticParams() {
  return [{ id: 'demo' }];
}

export default function ReplayPage() {
  return (
    <Suspense fallback={null}>
      <ReplayClient />
    </Suspense>
  );
}

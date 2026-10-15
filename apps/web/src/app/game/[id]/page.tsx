import React, { Suspense } from 'react';
import GameClient from './GameClient';
import { RouteIdProvider } from '@/lib/route-id';

export function generateStaticParams() {
  return [{ id: 'room' }];
}

export default function GamePage() {
  return (
    <Suspense fallback={null}>
      <RouteIdProvider segment="game">
        <GameClient />
      </RouteIdProvider>
    </Suspense>
  );
}

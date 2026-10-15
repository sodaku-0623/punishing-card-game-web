import React, { Suspense } from 'react';
import GameClient from './GameClient';

export function generateStaticParams() {
  return [{ id: 'room' }];
}

export default function GamePage() {
  return (
    <Suspense fallback={null}>
      <GameClient />
    </Suspense>
  );
}

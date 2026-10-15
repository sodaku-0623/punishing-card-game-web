import React, { Suspense } from 'react';
import RoomClient from './RoomClient';

export function generateStaticParams() {
  return [{ id: 'lobby' }];
}

export default function RoomPage() {
  return (
    <Suspense fallback={null}>
      <RoomClient />
    </Suspense>
  );
}

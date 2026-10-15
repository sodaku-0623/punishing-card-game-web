import React, { Suspense } from 'react';
import RoomClient from './RoomClient';
import { RouteIdProvider } from '@/lib/route-id';

export function generateStaticParams() {
  return [{ id: 'lobby' }];
}

export default function RoomPage() {
  return (
    <Suspense fallback={null}>
      <RouteIdProvider segment="rooms">
        <RoomClient />
      </RouteIdProvider>
    </Suspense>
  );
}

'use client';

import { useEffect } from 'react';

export function OrgAutoSync() {
  useEffect(() => {
    fetch('/api/orgs/sync', { method: 'POST' }).catch(() => {});
  }, []);
  return null;
}

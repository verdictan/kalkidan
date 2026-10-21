import { useEffect, useMemo, useState } from 'react';
import type { API } from '../types';
import { type TrackerDescriptor } from '../domain/tracker';
import { trackerClient } from '../lib/tracker-client';
import { errorMessage } from '../lib/errors';
export function useTracker(api: API, provider?: string) {
  const [providers, setProviders] = useState<TrackerDescriptor[]>([]);
  const selected = provider || providers[0]?.id || 'github';
  const client = useMemo(() => trackerClient(api, selected), [api, selected]);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    client
      .providers()
      .then((value) => {
        if (live) {
          setProviders(value);
          setError('');
        }
      })
      .catch((e) => {
        if (live) setError(errorMessage(e));
      });
    return () => {
      live = false;
    };
  }, [api]);
  const descriptor = providers.find((p) => p.id === selected);
  return {
    client,
    providers,
    ready: providers.length > 0,
    descriptor,
    provider: selected,
    name: descriptor?.name || selected,
    error,
  };
}

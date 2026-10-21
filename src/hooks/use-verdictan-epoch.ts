import { useEffect, useState } from 'react';
import type { API } from '../api/contracts';
/** Account-bound components remount before accepting results from the previous account. */
export function useVerdictanEpoch(api: API) {
  const [epoch, setEpoch] = useState(0);
  useEffect(() => api.onVerdictanChanged?.(() => setEpoch((value) => value + 1)), [api]);
  return epoch;
}

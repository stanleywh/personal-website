import { latestSafeReturn } from './engine';
self.onmessage = ({ data }) => {
  try { self.postMessage({ official: latestSafeReturn(data.timeline, data.departure, 'official', data.plans, data.closeTripId), conservative: latestSafeReturn(data.timeline, data.departure, 'conservative', data.plans, data.closeTripId) }); }
  catch (error) { self.postMessage({ error: error instanceof Error ? error.message : 'Calculation failed.' }); }
};

import { accountUrl } from '../auth/navigation';
import { authController } from '../auth/session';
import { createTrackerAuthGate } from '../tracker/auth-gate';
const guard = document.querySelector<HTMLElement>('[data-tracker-guard]')!;
const message = document.querySelector<HTMLElement>('[data-tracker-guard-message]')!;
const gate = createTrackerAuthGate({ guard, message });
try {
  const auth = await authController.initialize();
  if (auth.phase === 'signedOut' || auth.phase === 'profileIncomplete') window.location.replace(accountUrl(auth.phase === 'signedOut' ? 'login' : 'complete-profile', 'bno'));
  else if (auth.phase === 'signedIn') { await import('./main'); gate.finish(); }
  else gate.showError(auth.message ?? 'Accounts are unavailable.');
} catch (error) { gate.showError(error instanceof Error ? error.message : 'BNO could not be loaded.'); }

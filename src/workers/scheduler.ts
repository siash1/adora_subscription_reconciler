import { config } from '../config';
import { runCarrierPollCycle } from '../services/carrier';
import { runNotificationCycle } from '../services/notifications';

export function startWorkers(): () => void {
  const carrierTimer = setInterval(() => {
    runCarrierPollCycle().catch((err) => console.error('carrier poll cycle failed', err));
  }, config.carrierPollIntervalMs);

  const notificationTimer = setInterval(() => {
    runNotificationCycle().catch((err) => console.error('notification cycle failed', err));
  }, config.notificationScanIntervalMs);

  runCarrierPollCycle().catch((err) => console.error('carrier poll cycle failed', err));
  runNotificationCycle().catch((err) => console.error('notification cycle failed', err));

  return () => {
    clearInterval(carrierTimer);
    clearInterval(notificationTimer);
  };
}

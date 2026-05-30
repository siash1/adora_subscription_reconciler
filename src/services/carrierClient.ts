import { config } from '../config';

export type CarrierStatus = 'active' | 'inactive' | 'api_error';

export interface CarrierClient {
  fetchPlan(userId: string): Promise<CarrierStatus>;
}

export const httpCarrierClient: CarrierClient = {
  async fetchPlan(userId: string): Promise<CarrierStatus> {
    const url = `${config.carrierBaseUrl}/mock/carrier/plan?userId=${encodeURIComponent(userId)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.carrierTimeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) return 'api_error';
      const body = (await res.json()) as { status?: string };
      if (body.status === 'active' || body.status === 'inactive') return body.status;
      return 'api_error';
    } catch {
      return 'api_error';
    } finally {
      clearTimeout(timer);
    }
  },
};

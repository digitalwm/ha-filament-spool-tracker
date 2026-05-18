import { getHABaseUrl } from '../utils/haUrl';

export type HAState = {
  entity_id: string;
  state: string;
  attributes?: Record<string, unknown>;
};

function getToken(): string | null {
  return process.env.SUPERVISOR_TOKEN || null;
}

export async function fetchHAState(entityId: string): Promise<HAState | null> {
  const token = getToken();
  if (!token) return null;

  try {
    const response = await fetch(`${getHABaseUrl()}/api/states/${encodeURIComponent(entityId.toLowerCase())}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return null;
    const data = await response.json() as HAState;
    return data.state === 'unknown' || data.state === 'unavailable' ? null : data;
  } catch {
    return null;
  }
}

export async function fetchHAStates(): Promise<HAState[]> {
  const token = getToken();
  if (!token) return [];

  try {
    const response = await fetch(`${getHABaseUrl()}/api/states`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok) return [];
    return await response.json() as HAState[];
  } catch {
    return [];
  }
}

export async function fetchHAEntityState(entityId: string): Promise<string | null> {
  const data = await fetchHAState(entityId);
  return data?.state ?? null;
}

export async function fetchHAEntityValue(entityId: string, attribute?: string): Promise<string | null> {
  const data = await fetchHAState(entityId);
  if (!data) return null;
  if (!attribute || attribute === 'state') return data.state;
  const value = data.attributes?.[attribute];
  return typeof value === 'string' ? value : (value != null ? String(value) : null);
}

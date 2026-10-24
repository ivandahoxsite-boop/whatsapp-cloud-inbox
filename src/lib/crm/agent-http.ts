import { NextResponse } from 'next/server';
import { bearerOk } from './auth';

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });

/** Returns an error response when the caller is not the agent, otherwise null. */
export function guardAgent(request: Request): NextResponse | null {
  if (!process.env.CRM_AGENT_TOKEN?.trim()) return json({ error: 'CRM_AGENT_TOKEN is not set' }, 503);
  if (!bearerOk(request, 'CRM_AGENT_TOKEN')) return json({ error: 'Unauthorized' }, 401);
  return null;
}

export const fail = (e: unknown, status = 400) => json({ error: e instanceof Error ? e.message : 'Error' }, status);

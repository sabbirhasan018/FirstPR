import { isSupabaseConfigured } from '@/lib/env';
import { getSupabaseServerClient } from '@/lib/supabase/server';
import { sharedMemoryStore } from './memory';
import { createSupabaseStore } from './supabase';
import type { EvidenceStore } from './types';

/** Picks the Supabase store when credentials exist, otherwise local memory. */
export async function getStore(): Promise<EvidenceStore> {
  if (!isSupabaseConfigured()) return sharedMemoryStore();
  const client = await getSupabaseServerClient();
  return client ? createSupabaseStore(client) : sharedMemoryStore();
}

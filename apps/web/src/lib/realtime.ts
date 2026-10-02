import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import { supabase } from './supabase';

type Change = { table: string; eventType: 'INSERT' | 'UPDATE' | 'DELETE'; new: Record<string, unknown> };

/**
 * Listen for database changes and refetch the matching queries. Realtime payloads carry raw
 * columns, so they're only a signal to refetch (API-CONTRACT §5).
 * `tables` maps a table name to the query keys it invalidates.
 */
export function useRealtime(tables: Record<string, string[]>, onChange?: (c: Change) => void) {
  const qc = useQueryClient();
  const handler = useRef(onChange);
  handler.current = onChange;
  const key = JSON.stringify(tables);

  useEffect(() => {
    const map = JSON.parse(key) as Record<string, string[]>;
    const channel = supabase.channel(`rt-${Object.keys(map).join('-')}-${Math.random().toString(36).slice(2, 7)}`);
    for (const table of Object.keys(map)) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, (p) => {
        for (const k of map[table]!) void qc.invalidateQueries({ queryKey: [k] });
        handler.current?.({ table, eventType: p.eventType, new: (p.new ?? {}) as Record<string, unknown> });
      });
    }
    channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [key, qc]);
}

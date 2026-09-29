import type { Sql } from 'postgres';

export async function audit(
  db: Sql,
  entry: {
    actorId: string | null;
    action: string;
    entityType: string;
    entityId: string;
    before?: unknown;
    after?: unknown;
  },
) {
  await db`
    insert into public.audit_log (actor_id, action, entity_type, entity_id, before, after)
    values (
      ${entry.actorId}, ${entry.action}, ${entry.entityType}, ${entry.entityId},
      ${entry.before === undefined ? null : db.json(entry.before as never)},
      ${entry.after === undefined ? null : db.json(entry.after as never)}
    )
  `;
}

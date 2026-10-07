import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';
export const saves = sqliteTable('coffee_saves', {
  userId: text('user_id').primaryKey(), raw: text('raw'), revision: integer('revision').notNull().default(0),
  updatedAt: integer('updated_at').notNull().default(0), session: text('session'), epoch: integer('epoch').notNull().default(0),
  leaseUntil: integer('lease_until').notNull().default(0), lastOp: text('last_op'),
  ruleCutover: integer('counter_rule_cutover').notNull().default(0), onlineUntil: integer('online_until').notNull().default(0), protocol: integer('protocol').notNull().default(1),
});
export const operations = sqliteTable('coffee_operations', {
  userId: text('user_id').notNull(), opId: text('op_id').notNull(), hash: text('hash').notNull(),
  result: text('result'), revision: integer('revision').notNull(), createdAt: integer('created_at').notNull(), previousRaw: text('previous_raw'),
}, table => [primaryKey({columns: [table.userId, table.opId]})]);

export const backups = sqliteTable('coffee_backups', {
  userId: text('user_id').notNull(), id: text('id').notNull(), raw: text('raw').notNull(),
  reason: text('reason').notNull(), createdAt: integer('created_at').notNull(),
}, table => [primaryKey({columns: [table.userId, table.id]})]);

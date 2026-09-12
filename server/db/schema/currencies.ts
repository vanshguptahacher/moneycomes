import { pgTable, varchar, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const currencies = pgTable("currencies", {
  code: varchar("code", { length: 3 }).primaryKey(),
  name: varchar("name", { length: 64 }).notNull(),
  symbol: varchar("symbol", { length: 8 }).notNull(),
  minorUnits: integer("minor_units").default(2).notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type Currency = typeof currencies.$inferSelect;
export type NewCurrency = typeof currencies.$inferInsert;

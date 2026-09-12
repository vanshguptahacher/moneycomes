import { db } from "../db/client.js";

export type DrizzleDb = typeof db;
export type DrizzleTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Unified database context type.
 * Allows repositories to execute against either the root pool connection or within an active atomic transaction.
 */
export type DbOrTx = DrizzleDb | DrizzleTx;

import { relations } from "drizzle-orm";
import { activityEvents } from "./activity.js";
import { accounts, sessions } from "./auth.js";
import { attachments } from "./attachments.js";
import { categories } from "./categories.js";
import { currencies } from "./currencies.js";
import { expenses, expenseSplits } from "./expenses.js";
import { friendships } from "./friendships.js";
import { groups, groupMembers } from "./groups.js";
import { notifications } from "./notifications.js";
import { settlements } from "./settlements.js";
import { users } from "./users.js";

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(groupMembers),
  createdGroups: many(groups),
  payerExpenses: many(expenses, { relationName: "payerExpenses" }),
  createdExpenses: many(expenses, { relationName: "createdExpenses" }),
  splits: many(expenseSplits),
  paidSettlements: many(settlements, { relationName: "paidSettlements" }),
  receivedSettlements: many(settlements, { relationName: "receivedSettlements" }),
  friendshipsInitiated: many(friendships, { relationName: "friendshipsInitiated" }),
  friendshipsReceived: many(friendships, { relationName: "friendshipsReceived" }),
  activities: many(activityEvents),
  receivedNotifications: many(notifications, { relationName: "recipientNotifications" }),
  initiatedNotifications: many(notifications, { relationName: "actorNotifications" }),
  uploadedAttachments: many(attachments),
  sessions: many(sessions),
  accounts: many(accounts),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, {
    fields: [accounts.userId],
    references: [users.id],
  }),
}));

export const currenciesRelations = relations(currencies, ({ many }) => ({
  groups: many(groups),
  expenses: many(expenses),
  settlements: many(settlements),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
  expenses: many(expenses),
}));

export const friendshipsRelations = relations(friendships, ({ one }) => ({
  user1: one(users, {
    fields: [friendships.userId1],
    references: [users.id],
    relationName: "friendshipsInitiated",
  }),
  user2: one(users, {
    fields: [friendships.userId2],
    references: [users.id],
    relationName: "friendshipsReceived",
  }),
}));

export const groupsRelations = relations(groups, ({ one, many }) => ({
  creator: one(users, {
    fields: [groups.createdById],
    references: [users.id],
  }),
  defaultCurrency: one(currencies, {
    fields: [groups.defaultCurrencyCode],
    references: [currencies.code],
  }),
  members: many(groupMembers),
  expenses: many(expenses),
  settlements: many(settlements),
  activities: many(activityEvents),
}));

export const groupMembersRelations = relations(groupMembers, ({ one }) => ({
  group: one(groups, {
    fields: [groupMembers.groupId],
    references: [groups.id],
  }),
  user: one(users, {
    fields: [groupMembers.userId],
    references: [users.id],
  }),
}));

export const expensesRelations = relations(expenses, ({ one, many }) => ({
  group: one(groups, {
    fields: [expenses.groupId],
    references: [groups.id],
  }),
  payer: one(users, {
    fields: [expenses.payerId],
    references: [users.id],
    relationName: "payerExpenses",
  }),
  createdBy: one(users, {
    fields: [expenses.createdById],
    references: [users.id],
    relationName: "createdExpenses",
  }),
  category: one(categories, {
    fields: [expenses.categoryId],
    references: [categories.id],
  }),
  currency: one(currencies, {
    fields: [expenses.currencyCode],
    references: [currencies.code],
  }),
  splits: many(expenseSplits),
  attachments: many(attachments),
}));

export const expenseSplitsRelations = relations(expenseSplits, ({ one }) => ({
  expense: one(expenses, {
    fields: [expenseSplits.expenseId],
    references: [expenses.id],
  }),
  user: one(users, {
    fields: [expenseSplits.userId],
    references: [users.id],
  }),
}));

export const settlementsRelations = relations(settlements, ({ one }) => ({
  payer: one(users, {
    fields: [settlements.payerId],
    references: [users.id],
    relationName: "paidSettlements",
  }),
  receiver: one(users, {
    fields: [settlements.receiverId],
    references: [users.id],
    relationName: "receivedSettlements",
  }),
  group: one(groups, {
    fields: [settlements.groupId],
    references: [groups.id],
  }),
  createdBy: one(users, {
    fields: [settlements.createdById],
    references: [users.id],
  }),
  currency: one(currencies, {
    fields: [settlements.currencyCode],
    references: [currencies.code],
  }),
}));

export const activityEventsRelations = relations(activityEvents, ({ one }) => ({
  actor: one(users, {
    fields: [activityEvents.actorId],
    references: [users.id],
  }),
  group: one(groups, {
    fields: [activityEvents.groupId],
    references: [groups.id],
  }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  recipient: one(users, {
    fields: [notifications.recipientId],
    references: [users.id],
    relationName: "recipientNotifications",
  }),
  actor: one(users, {
    fields: [notifications.actorId],
    references: [users.id],
    relationName: "actorNotifications",
  }),
  group: one(groups, {
    fields: [notifications.groupId],
    references: [groups.id],
  }),
  expense: one(expenses, {
    fields: [notifications.expenseId],
    references: [expenses.id],
  }),
  settlement: one(settlements, {
    fields: [notifications.settlementId],
    references: [settlements.id],
  }),
  activity: one(activityEvents, {
    fields: [notifications.activityId],
    references: [activityEvents.id],
  }),
}));

export const attachmentsRelations = relations(attachments, ({ one }) => ({
  expense: one(expenses, {
    fields: [attachments.expenseId],
    references: [expenses.id],
  }),
  uploader: one(users, {
    fields: [attachments.uploadedById],
    references: [users.id],
  }),
}));


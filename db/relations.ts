import { relations } from "drizzle-orm";
import { grantPrograms, clients, cases, reviews } from "./schema";

export const clientsRelations = relations(clients, ({ many }) => ({
  cases: many(cases),
}));

export const grantProgramsRelations = relations(grantPrograms, ({ many }) => ({
  cases: many(cases),
}));

export const casesRelations = relations(cases, ({ one, many }) => ({
  client: one(clients, { fields: [cases.clientId], references: [clients.id] }),
  grant: one(grantPrograms, { fields: [cases.grantId], references: [grantPrograms.id] }),
  reviews: many(reviews),
}));

export const reviewsRelations = relations(reviews, ({ one }) => ({
  case: one(cases, { fields: [reviews.caseId], references: [cases.id] }),
}));

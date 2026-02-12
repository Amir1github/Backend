import { sql } from "drizzle-orm";
import { pgTable, text, varchar, serial, integer, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Re-export auth models
export * from "./models/auth";

// Assistants table - linked to users
export const assistants = pgTable("assistants", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  name: text("name").notNull(),
  type: text("type").notNull().default("PERSONAL"),
  sphere: text("sphere"),
  role: text("role").notNull(),
  goals: text("goals"),
  personality: text("personality"),
  knowledgeBase: jsonb("knowledge_base").$type<string[]>().default([]),
  catalog: jsonb("catalog").$type<any[]>().default([]),
  scenarios: text("scenarios"),
  integrations: jsonb("integrations").$type<string[]>().default([]),
  integrationConfigs: jsonb("integration_configs").$type<Record<string, any>>().default({}),
  status: text("status").notNull().default("draft"),
  authorName: text("author_name"),
  isPublished: boolean("is_published").default(false),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertAssistantSchema = createInsertSchema(assistants).omit({
  id: true,
  createdAt: true,
});

export type InsertAssistant = z.infer<typeof insertAssistantSchema>;
export type Assistant = typeof assistants.$inferSelect;

// Conversations table for chat history
export const conversations = pgTable("conversations", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  title: text("title").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertConversationSchema = createInsertSchema(conversations).omit({
  id: true,
  createdAt: true,
});

export const insertMessageSchema = createInsertSchema(messages).omit({
  id: true,
  createdAt: true,
});

export type Conversation = typeof conversations.$inferSelect;
export type InsertConversation = z.infer<typeof insertConversationSchema>;
export type Message = typeof messages.$inferSelect;
export type InsertMessage = z.infer<typeof insertMessageSchema>;

export const knowledgeBaseFiles = pgTable("knowledge_base_files", {
  id: serial("id").primaryKey(),
  assistantId: integer("assistant_id").notNull().references(() => assistants.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull(),
  fileName: text("file_name").notNull(),
  fileType: text("file_type").notNull(),
  fileSize: integer("file_size").notNull(),
  rowCount: integer("row_count").default(0),
  content: text("content").notNull(),
  status: text("status").notNull().default("processing"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertKnowledgeBaseFileSchema = createInsertSchema(knowledgeBaseFiles).omit({
  id: true,
  createdAt: true,
});

export type KnowledgeBaseFile = typeof knowledgeBaseFiles.$inferSelect;
export type InsertKnowledgeBaseFile = z.infer<typeof insertKnowledgeBaseFileSchema>;

export const chatLogs = pgTable("chat_logs", {
  id: serial("id").primaryKey(),
  assistantId: integer("assistant_id").notNull().references(() => assistants.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull(),
  channel: text("channel").notNull(),
  senderName: text("sender_name"),
  senderContact: text("sender_contact"),
  userMessage: text("user_message").notNull(),
  aiResponse: text("ai_response").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertChatLogSchema = createInsertSchema(chatLogs).omit({
  id: true,
  createdAt: true,
});

export type ChatLog = typeof chatLogs.$inferSelect;
export type InsertChatLog = z.infer<typeof insertChatLogSchema>;

export const pipelineStages = pgTable("pipeline_stages", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  assistantId: integer("assistant_id").notNull().references(() => assistants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertPipelineStageSchema = createInsertSchema(pipelineStages).omit({
  id: true,
  createdAt: true,
});

export type PipelineStage = typeof pipelineStages.$inferSelect;
export type InsertPipelineStage = z.infer<typeof insertPipelineStageSchema>;

export const pipelineContacts = pgTable("pipeline_contacts", {
  id: serial("id").primaryKey(),
  userId: varchar("user_id").notNull(),
  assistantId: integer("assistant_id").notNull().references(() => assistants.id, { onDelete: "cascade" }),
  stageId: integer("stage_id").notNull().references(() => pipelineStages.id, { onDelete: "cascade" }),
  clientName: text("client_name"),
  clientContact: text("client_contact"),
  channel: text("channel").notNull(),
  lastMessage: text("last_message"),
  stageName: text("stage_name").notNull(),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertPipelineContactSchema = createInsertSchema(pipelineContacts).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type PipelineContact = typeof pipelineContacts.$inferSelect;
export type InsertPipelineContact = z.infer<typeof insertPipelineContactSchema>;

export const products = pgTable("products", {
  id: serial("id").primaryKey(),
  assistantId: integer("assistant_id").notNull().references(() => assistants.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull(),
  type: text("type").notNull().default("product"),
  name: text("name").notNull(),
  description: text("description"),
  price: text("price").notNull(),
  currency: text("currency").notNull().default("USD"),
  available: boolean("available").notNull().default(true),
  characteristics: text("characteristics"),
  photoData: text("photo_data"),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const insertProductSchema = createInsertSchema(products).omit({
  id: true,
  createdAt: true,
});

export type Product = typeof products.$inferSelect;
export type InsertProduct = z.infer<typeof insertProductSchema>;

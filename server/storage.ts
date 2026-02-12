import { type User, type InsertUser, type Assistant, type InsertAssistant, type Conversation, type InsertConversation, type Message, type InsertMessage } from "@shared/schema";
import { randomUUID } from "crypto";

export interface IStorage {
  // Users
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  
  // Assistants
  getAssistant(id: number): Promise<Assistant | undefined>;
  getAllAssistants(): Promise<Assistant[]>;
  createAssistant(assistant: InsertAssistant): Promise<Assistant>;
  updateAssistant(id: number, data: Partial<InsertAssistant>): Promise<Assistant | undefined>;
  deleteAssistant(id: number): Promise<void>;
  
  // Conversations
  getConversation(id: number): Promise<Conversation | undefined>;
  getAllConversations(): Promise<Conversation[]>;
  createConversation(title: string): Promise<Conversation>;
  deleteConversation(id: number): Promise<void>;
  
  // Messages
  getMessagesByConversation(conversationId: number): Promise<Message[]>;
  createMessage(conversationId: number, role: string, content: string): Promise<Message>;
}

export class MemStorage implements IStorage {
  private users: Map<string, User>;
  private assistants: Map<number, Assistant>;
  private conversations: Map<number, Conversation>;
  private messages: Map<number, Message>;
  private assistantCounter: number = 1;
  private conversationCounter: number = 1;
  private messageCounter: number = 1;

  constructor() {
    this.users = new Map();
    this.assistants = new Map();
    this.conversations = new Map();
    this.messages = new Map();
  }

  // Users
  async getUser(id: string): Promise<User | undefined> {
    return this.users.get(id);
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return Array.from(this.users.values()).find(
      (user) => user.username === username,
    );
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const id = randomUUID();
    const user: User = { ...insertUser, id };
    this.users.set(id, user);
    return user;
  }

  // Assistants
  async getAssistant(id: number): Promise<Assistant | undefined> {
    return this.assistants.get(id);
  }

  async getAllAssistants(): Promise<Assistant[]> {
    return Array.from(this.assistants.values()).sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async createAssistant(data: InsertAssistant): Promise<Assistant> {
    const id = this.assistantCounter++;
    const assistant: Assistant = {
      id,
      name: data.name,
      type: data.type || "PERSONAL",
      role: data.role,
      goals: data.goals || null,
      personality: data.personality || null,
      knowledgeBase: data.knowledgeBase || [],
      catalog: data.catalog || [],
      scenarios: data.scenarios || null,
      integrations: data.integrations || [],
      integrationConfigs: data.integrationConfigs || {},
      status: data.status || "draft",
      authorName: data.authorName || null,
      isPublished: data.isPublished || false,
      createdAt: new Date(),
    };
    this.assistants.set(id, assistant);
    return assistant;
  }

  async updateAssistant(id: number, data: Partial<InsertAssistant>): Promise<Assistant | undefined> {
    const existing = this.assistants.get(id);
    if (!existing) return undefined;
    
    const updated: Assistant = { ...existing, ...data };
    this.assistants.set(id, updated);
    return updated;
  }

  async deleteAssistant(id: number): Promise<void> {
    this.assistants.delete(id);
  }

  // Conversations
  async getConversation(id: number): Promise<Conversation | undefined> {
    return this.conversations.get(id);
  }

  async getAllConversations(): Promise<Conversation[]> {
    return Array.from(this.conversations.values()).sort((a, b) => 
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async createConversation(title: string): Promise<Conversation> {
    const id = this.conversationCounter++;
    const conversation: Conversation = {
      id,
      title,
      createdAt: new Date(),
    };
    this.conversations.set(id, conversation);
    return conversation;
  }

  async deleteConversation(id: number): Promise<void> {
    this.conversations.delete(id);
    // Delete associated messages
    Array.from(this.messages.entries()).forEach(([msgId, msg]) => {
      if (msg.conversationId === id) {
        this.messages.delete(msgId);
      }
    });
  }

  // Messages
  async getMessagesByConversation(conversationId: number): Promise<Message[]> {
    return Array.from(this.messages.values())
      .filter(m => m.conversationId === conversationId)
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }

  async createMessage(conversationId: number, role: string, content: string): Promise<Message> {
    const id = this.messageCounter++;
    const message: Message = {
      id,
      conversationId,
      role,
      content,
      createdAt: new Date(),
    };
    this.messages.set(id, message);
    return message;
  }
}

export const storage = new MemStorage();

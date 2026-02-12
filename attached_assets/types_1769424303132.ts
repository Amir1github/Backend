
export enum UserRole {
  ADMIN = 'ADMIN',
  BUSINESS = 'BUSINESS',
  PERSONAL = 'PERSONAL'
}

export enum AssistantType {
  PERSONAL = 'PERSONAL',
  BUSINESS = 'BUSINESS'
}

export enum SubscriptionPlan {
  FREE = 'FREE',
  PRO = 'PRO',
  BUSINESS = 'BUSINESS',
  ENTERPRISE = 'ENTERPRISE'
}

export interface CatalogItem {
  id: string;
  name: string;
  priceOrCategory: string;
  description: string;
}

export interface IntegrationConfig {
  platformId: string;
  botName?: string;
  token?: string;
  isEnabled: boolean;
  webhookUrl?: string;
}

export interface Assistant {
  id: string;
  name: string;
  type: AssistantType;
  role: string;
  goals: string;
  personality: string;
  knowledgeBase: string[];
  catalog?: CatalogItem[]; // Структурированные данные о продуктах
  scenarios: string;
  integrations: string[];
  integrationConfigs?: Record<string, IntegrationConfig>;
  status: 'draft' | 'active';
  createdAt: number;
  authorName?: string;
  isPublished?: boolean;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

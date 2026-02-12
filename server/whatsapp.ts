import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import { GoogleGenAI } from '@google/genai';
import { db } from './db';
import { assistants, knowledgeBaseFiles, chatLogs, pipelineStages, pipelineContacts } from '@shared/schema';
import { eq, and, asc } from 'drizzle-orm';
import { execSync } from 'child_process';

interface WhatsAppSession {
  client: any;
  status: 'initializing' | 'qr' | 'authenticated' | 'ready' | 'disconnected';
  qrCode: string | null;
  pairingCode: string | null;
  userId: string;
  assistantId: number;
  phoneNumber: string | null;
}

const sessions: Map<string, WhatsAppSession> = new Map();

const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: {
    apiVersion: "",
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
  },
});

function getChromiumPath(): string {
  try {
    const chromiumPath = execSync('which chromium', { encoding: 'utf-8' }).trim();
    if (chromiumPath) return chromiumPath;
  } catch (e) {}
  try {
    const chromiumPath = execSync('find /nix/store -name chromium -type f -executable 2>/dev/null | head -1', { encoding: 'utf-8' }).trim();
    if (chromiumPath) return chromiumPath;
  } catch (e) {}
  return process.env.PUPPETEER_EXECUTABLE_PATH || '/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium';
}

function getSessionKey(userId: string, assistantId: number): string {
  return `${userId}_${assistantId}`;
}

export async function createWhatsAppSession(
  userId: string,
  assistantId: number
): Promise<{ success: boolean; qrCode?: string; error?: string }> {
  const sessionKey = getSessionKey(userId, assistantId);
  
  const existingSession = sessions.get(sessionKey);
  if (existingSession && existingSession.status === 'ready') {
    return { success: true };
  }

  if (existingSession) {
    try {
      await existingSession.client.destroy();
    } catch (e) {
      console.log('Error destroying existing session:', e);
    }
    sessions.delete(sessionKey);
  }

  const chromiumPath = getChromiumPath();
  console.log(`[WhatsApp] Using Chromium at: ${chromiumPath}`);

  return new Promise((resolve) => {
    try {
      const client = new Client({
        authStrategy: new LocalAuth({ clientId: sessionKey }),
        puppeteer: {
          headless: true,
          executablePath: chromiumPath,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu',
            '--disable-extensions',
            '--disable-background-networking',
            '--disable-default-apps',
            '--disable-sync',
            '--disable-translate',
            '--metrics-recording-only',
            '--mute-audio',
            '--no-default-browser-check',
          ],
        }
      });

      const session: WhatsAppSession = {
        client,
        status: 'initializing',
        qrCode: null,
        pairingCode: null,
        userId,
        assistantId,
        phoneNumber: null
      };

      sessions.set(sessionKey, session);

      let qrResolved = false;

      client.on('qr', (qr: string) => {
        session.qrCode = qr;
        session.status = 'qr';
        console.log(`[WhatsApp] QR code generated for session ${sessionKey}`);
        if (!qrResolved) {
          qrResolved = true;
          resolve({ success: true, qrCode: qr });
        }
      });

      client.on('authenticated', () => {
        session.status = 'authenticated';
        console.log(`[WhatsApp] Session ${sessionKey} authenticated`);
      });

      client.on('ready', () => {
        session.status = 'ready';
        session.qrCode = null;
        session.pairingCode = null;
        console.log(`[WhatsApp] Session ${sessionKey} is ready`);
      });

      client.on('disconnected', (reason: string) => {
        session.status = 'disconnected';
        console.log(`[WhatsApp] Session ${sessionKey} disconnected:`, reason);
      });

      client.on('message', async (message: any) => {
        await handleIncomingMessage(session, message);
      });

      client.on('auth_failure', (msg: string) => {
        console.error(`[WhatsApp] Auth failure for session ${sessionKey}:`, msg);
        if (!qrResolved) {
          qrResolved = true;
          resolve({ success: false, error: 'Authentication failed' });
        }
      });

      client.initialize().catch((error: any) => {
        console.error(`[WhatsApp] Error initializing:`, error);
        if (!qrResolved) {
          qrResolved = true;
          sessions.delete(sessionKey);
          resolve({ success: false, error: error.message || 'Failed to initialize WhatsApp. Please try again.' });
        }
      });

      setTimeout(() => {
        if (!qrResolved) {
          qrResolved = true;
          resolve({ success: false, error: 'Timeout waiting for QR code. Please try again.' });
        }
      }, 60000);

    } catch (error: any) {
      console.error(`[WhatsApp] Error creating session:`, error);
      sessions.delete(sessionKey);
      resolve({ success: false, error: error.message || 'Failed to create WhatsApp session' });
    }
  });
}

async function handleIncomingMessage(session: WhatsAppSession, message: any) {
  try {
    if (message.fromMe) return;
    
    const contact = await message.getContact();
    const chatId = message.from;
    
    console.log(`[WhatsApp] Message from ${contact.pushname || chatId}: ${message.body}`);

    const [assistant] = await db
      .select()
      .from(assistants)
      .where(eq(assistants.id, session.assistantId));
    
    if (!assistant) {
      console.error(`[WhatsApp] Assistant ${session.assistantId} not found`);
      return;
    }

    let systemPrompt = `Ты ${assistant.name}, ${assistant.role}. 
${assistant.personality ? `Твоя личность: ${assistant.personality}` : ''}
${assistant.goals ? `Твои цели: ${assistant.goals}` : ''}
${assistant.scenarios ? `Сценарии работы: ${assistant.scenarios}` : ''}

Отвечай кратко и по делу. Это WhatsApp переписка.`;

    const kbFiles = await db
      .select()
      .from(knowledgeBaseFiles)
      .where(and(
        eq(knowledgeBaseFiles.assistantId, session.assistantId),
        eq(knowledgeBaseFiles.status, 'ready')
      ));

    if (kbFiles.length > 0) {
      systemPrompt += `\n\n=== БАЗА ЗНАНИЙ ===\n`;
      for (const file of kbFiles) {
        const contentPreview = file.content.length > 50000 ? file.content.substring(0, 50000) + '\n...(данные обрезаны)' : file.content;
        systemPrompt += `--- ${file.fileName} (${file.rowCount} записей) ---\n${contentPreview}\n\n`;
      }
      systemPrompt += `=== КОНЕЦ БАЗЫ ЗНАНИЙ ===\nИспользуй данные из базы знаний для точных ответов.\n`;
    }

    const stages = await db
      .select()
      .from(pipelineStages)
      .where(eq(pipelineStages.assistantId, session.assistantId))
      .orderBy(asc(pipelineStages.sortOrder));

    if (stages.length > 0) {
      systemPrompt += `\n\n=== ОБЯЗАТЕЛЬНО: СТАДИИ ВОРОНКИ ПРОДАЖ ===\n`;
      systemPrompt += `ВАЖНО! Ты ОБЯЗАН в каждом ответе определять стадию клиента в воронке продаж.\n\n`;
      systemPrompt += `Стадии (в порядке продвижения):\n`;
      for (const stage of stages) {
        systemPrompt += `${stage.sortOrder + 1}. "${stage.name}" — Условия: ${stage.description}\n`;
      }
      systemPrompt += `\nВ КАЖДОМ ответе добавляй в конце: [Стадия: <название>]\n`;
      systemPrompt += `=== КОНЕЦ СТАДИЙ ВОРОНКИ ===\n`;
    }

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        { role: 'user', parts: [{ text: systemPrompt }] },
        { role: 'model', parts: [{ text: 'Понял, я готов помочь.' }] },
        { role: 'user', parts: [{ text: message.body }] }
      ]
    });

    const replyText = response.text || 'Извините, не могу ответить сейчас.';
    
    await message.reply(replyText);
    console.log(`[WhatsApp] Replied to ${contact.pushname || chatId}: ${replyText.substring(0, 50)}...`);

    try {
      await db.insert(chatLogs).values({
        assistantId: session.assistantId,
        userId: session.userId,
        channel: 'whatsapp',
        senderName: contact.pushname || null,
        senderContact: chatId,
        userMessage: message.body,
        aiResponse: replyText,
      });
    } catch (logError) {
      console.error('[WhatsApp] Error saving chat log:', logError);
    }

    const stageMatch = replyText.match(/\[(?:Стадия|Stage):\s*(.+?)\]/i);
    if (stageMatch) {
      const detectedStageName = stageMatch[1].trim();
      try {
        const [matchedStage] = await db
          .select()
          .from(pipelineStages)
          .where(and(
            eq(pipelineStages.assistantId, session.assistantId),
            eq(pipelineStages.name, detectedStageName)
          ));

        if (matchedStage) {
          const [existingContact] = await db
            .select()
            .from(pipelineContacts)
            .where(and(
              eq(pipelineContacts.assistantId, session.assistantId),
              eq(pipelineContacts.clientContact, chatId)
            ));

          if (existingContact) {
            await db.update(pipelineContacts)
              .set({
                stageId: matchedStage.id,
                stageName: detectedStageName,
                lastMessage: message.body,
                clientName: contact.pushname || existingContact.clientName,
                updatedAt: new Date(),
              })
              .where(eq(pipelineContacts.id, existingContact.id));
          } else {
            await db.insert(pipelineContacts).values({
              userId: session.userId,
              assistantId: session.assistantId,
              stageId: matchedStage.id,
              clientName: contact.pushname || 'WhatsApp контакт',
              clientContact: chatId,
              channel: 'whatsapp',
              lastMessage: message.body,
              stageName: detectedStageName,
            });
          }
        }
      } catch (pipelineError) {
        console.error('[WhatsApp] Error saving pipeline contact:', pipelineError);
      }
    }
  } catch (error) {
    console.error('[WhatsApp] Error handling message:', error);
  }
}

export function getSessionStatus(userId: string, assistantId: number): {
  status: string;
  qrCode: string | null;
  pairingCode: string | null;
  phoneNumber: string | null;
} {
  const sessionKey = getSessionKey(userId, assistantId);
  const session = sessions.get(sessionKey);
  
  if (!session) {
    return { status: 'not_connected', qrCode: null, pairingCode: null, phoneNumber: null };
  }

  return {
    status: session.status,
    qrCode: session.qrCode,
    pairingCode: session.pairingCode,
    phoneNumber: session.phoneNumber
  };
}

export async function disconnectSession(userId: string, assistantId: number): Promise<boolean> {
  const sessionKey = getSessionKey(userId, assistantId);
  const session = sessions.get(sessionKey);
  
  if (!session) {
    return false;
  }

  try {
    await session.client.logout();
    await session.client.destroy();
    sessions.delete(sessionKey);
    return true;
  } catch (error) {
    console.error('[WhatsApp] Error disconnecting:', error);
    sessions.delete(sessionKey);
    return false;
  }
}

export function getAllUserSessions(userId: string): Array<{
  assistantId: number;
  status: string;
  phoneNumber: string | null;
}> {
  const userSessions: Array<{ assistantId: number; status: string; phoneNumber: string | null }> = [];
  
  sessions.forEach((session, key) => {
    if (session.userId === userId) {
      userSessions.push({
        assistantId: session.assistantId,
        status: session.status,
        phoneNumber: session.phoneNumber
      });
    }
  });

  return userSessions;
}

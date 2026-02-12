import { IgApiClient } from 'instagram-private-api';
import { GoogleGenAI } from '@google/genai';
import { db } from './db';
import { assistants, knowledgeBaseFiles, chatLogs, pipelineStages, pipelineContacts } from '@shared/schema';
import { eq, and, asc } from 'drizzle-orm';

interface InstagramSession {
  ig: IgApiClient;
  status: 'connecting' | 'connected' | 'disconnected' | 'error';
  username: string;
  userId: string;
  assistantId: number;
  myPk: number;
  pollingInterval: ReturnType<typeof setInterval> | null;
  lastCheckedTimestamp: number;
  processedMessageIds: Set<string>;
  consecutiveErrors: number;
  error?: string;
}

const sessions: Map<string, InstagramSession> = new Map();

const ai = new GoogleGenAI({
  apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
  httpOptions: {
    apiVersion: "",
    baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
  },
});

function getSessionKey(userId: string, assistantId: number): string {
  return `ig_${userId}_${assistantId}`;
}

export async function connectInstagram(
  userId: string,
  assistantId: number,
  username: string,
  password: string
): Promise<{ success: boolean; error?: string; username?: string }> {
  const sessionKey = getSessionKey(userId, assistantId);

  const existing = sessions.get(sessionKey);
  if (existing && existing.status === 'connected') {
    return { success: true, username: existing.username };
  }

  if (existing) {
    stopPolling(existing);
    sessions.delete(sessionKey);
  }

  const ig = new IgApiClient();

  try {
    ig.state.generateDevice(username);

    const session: InstagramSession = {
      ig,
      status: 'connecting',
      username,
      userId,
      assistantId,
      myPk: 0,
      pollingInterval: null,
      lastCheckedTimestamp: Date.now(),
      processedMessageIds: new Set(),
      consecutiveErrors: 0,
    };
    sessions.set(sessionKey, session);

    console.log(`[Instagram] Logging in as @${username}...`);
    const loggedInUser = await ig.account.login(username, password);
    console.log(`[Instagram] Successfully logged in as @${username} (pk: ${loggedInUser.pk})`);

    session.status = 'connected';
    session.myPk = loggedInUser.pk;

    startPolling(session, sessionKey);

    return { success: true, username };
  } catch (error: any) {
    console.error(`[Instagram] Login failed for @${username}:`, error.message);

    const session = sessions.get(sessionKey);
    if (session) {
      session.status = 'error';
      session.error = error.message;
    }

    let errorMessage = 'Login failed. Please check your credentials.';
    if (error.name === 'IgLoginTwoFactorRequiredError') {
      errorMessage = 'Two-factor authentication required. Please disable 2FA temporarily or use an app password.';
    } else if (error.name === 'IgCheckpointError') {
      errorMessage = 'Instagram security checkpoint triggered. Please verify your account in the Instagram app first, then try again.';
    } else if (error.name === 'IgLoginBadPasswordError') {
      errorMessage = 'Incorrect password. Please try again.';
    } else if (error.name === 'IgLoginInvalidUserError') {
      errorMessage = 'Username not found. Please check your username.';
    }

    return { success: false, error: errorMessage };
  }
}

function startPolling(session: InstagramSession, sessionKey: string) {
  if (session.pollingInterval) {
    clearInterval(session.pollingInterval);
  }

  console.log(`[Instagram] Starting DM polling for @${session.username}`);

  const pollInterval = 20000;
  session.pollingInterval = setInterval(async () => {
    if (session.status !== 'connected') {
      stopPolling(session);
      return;
    }

    try {
      await checkNewMessages(session);
      session.consecutiveErrors = 0;
    } catch (error: any) {
      session.consecutiveErrors++;
      console.error(`[Instagram] Polling error #${session.consecutiveErrors} for @${session.username}:`, error.message);
      
      if (error.name === 'IgLoginRequiredError' || error.name === 'IgCookieNotFoundError') {
        session.status = 'disconnected';
        session.error = 'Session expired. Please reconnect.';
        stopPolling(session);
      } else if (session.consecutiveErrors >= 10) {
        console.error(`[Instagram] Too many consecutive errors for @${session.username}, stopping polling`);
        session.status = 'error';
        session.error = 'Too many errors. Please reconnect.';
        stopPolling(session);
      }
    }
  }, pollInterval);
}

function stopPolling(session: InstagramSession) {
  if (session.pollingInterval) {
    clearInterval(session.pollingInterval);
    session.pollingInterval = null;
  }
}

async function checkNewMessages(session: InstagramSession) {
  const inbox = session.ig.feed.directInbox();
  const threads = await inbox.items();

  if (!threads || threads.length === 0) return;

  for (const thread of threads.slice(0, 10)) {
    try {
      const lastItem = thread.last_permanent_item;
      if (!lastItem) continue;

      const itemId = lastItem.item_id;
      if (session.processedMessageIds.has(itemId)) continue;

      if (session.myPk && lastItem.user_id === session.myPk) continue;

      const itemTimestamp = Number(lastItem.timestamp) / 1000;
      if (itemTimestamp < session.lastCheckedTimestamp / 1000) continue;

      const messageText = lastItem.text || '';
      if (!messageText.trim()) continue;

      session.processedMessageIds.add(itemId);

      const senderName = thread.thread_title || 'Instagram User';
      const senderId = String(lastItem.user_id);

      console.log(`[Instagram] New DM from ${senderName}: ${messageText.substring(0, 50)}...`);

      const aiReply = await generateAIResponse(session.assistantId, session.userId, messageText);

      const threadEntity = session.ig.entity.directThread(thread.thread_id);
      await threadEntity.broadcastText(aiReply);

      console.log(`[Instagram] Replied to ${senderName}: ${aiReply.substring(0, 50)}...`);

      try {
        await db.insert(chatLogs).values({
          assistantId: session.assistantId,
          userId: session.userId,
          channel: 'instagram',
          senderName,
          senderContact: `@${senderId}`,
          userMessage: messageText,
          aiResponse: aiReply,
        });
      } catch (logError) {
        console.error('[Instagram] Error saving chat log:', logError);
      }

      await savePipelineContact(session, senderName, senderId, messageText, aiReply);

    } catch (threadError: any) {
      console.error('[Instagram] Error processing thread:', threadError.message);
    }
  }

  if (session.processedMessageIds.size > 1000) {
    const entries = Array.from(session.processedMessageIds);
    session.processedMessageIds = new Set(entries.slice(-500));
  }

  session.lastCheckedTimestamp = Date.now();
}

async function generateAIResponse(assistantId: number, userId: string, userMessage: string): Promise<string> {
  try {
    const [assistant] = await db
      .select()
      .from(assistants)
      .where(eq(assistants.id, assistantId));

    if (!assistant) return 'Sorry, I cannot respond right now.';

    let systemPrompt = `Ты ${assistant.name}, ${assistant.role}. 
${assistant.personality ? `Твоя личность: ${assistant.personality}` : ''}
${assistant.goals ? `Твои цели: ${assistant.goals}` : ''}
${assistant.scenarios ? `Сценарии работы: ${assistant.scenarios}` : ''}

Отвечай кратко и по делу. Это Instagram Direct переписка.`;

    const kbFiles = await db
      .select()
      .from(knowledgeBaseFiles)
      .where(and(
        eq(knowledgeBaseFiles.assistantId, assistantId),
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
      .where(eq(pipelineStages.assistantId, assistantId))
      .orderBy(asc(pipelineStages.sortOrder));

    if (stages.length > 0) {
      systemPrompt += `\n\n=== СТАДИИ ВОРОНКИ ПРОДАЖ ===\n`;
      systemPrompt += `Определяй стадию клиента в воронке.\n`;
      for (const stage of stages) {
        systemPrompt += `${stage.sortOrder + 1}. "${stage.name}" — ${stage.description}\n`;
      }
      systemPrompt += `В конце ответа добавляй: [Стадия: <название>]\n`;
      systemPrompt += `=== КОНЕЦ СТАДИЙ ВОРОНКИ ===\n`;
    }

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        { role: 'user', parts: [{ text: systemPrompt }] },
        { role: 'model', parts: [{ text: 'Понял, я готов помочь.' }] },
        { role: 'user', parts: [{ text: userMessage }] }
      ]
    });

    return response.text || 'Извините, не могу ответить сейчас.';
  } catch (error) {
    console.error('[Instagram] AI response error:', error);
    return 'Извините, не могу ответить сейчас.';
  }
}

async function savePipelineContact(
  session: InstagramSession,
  senderName: string,
  senderId: string,
  userMessage: string,
  aiReply: string
) {
  try {
    const stageMatch = aiReply.match(/\[(?:Стадия|Stage):\s*(.+?)\]/i);
    if (!stageMatch) return;

    const detectedStageName = stageMatch[1].trim();

    const [matchedStage] = await db
      .select()
      .from(pipelineStages)
      .where(and(
        eq(pipelineStages.assistantId, session.assistantId),
        eq(pipelineStages.name, detectedStageName)
      ));

    if (!matchedStage) return;

    const contactId = `ig_${senderId}`;
    const [existingContact] = await db
      .select()
      .from(pipelineContacts)
      .where(and(
        eq(pipelineContacts.assistantId, session.assistantId),
        eq(pipelineContacts.clientContact, contactId)
      ));

    if (existingContact) {
      await db.update(pipelineContacts)
        .set({
          stageId: matchedStage.id,
          stageName: detectedStageName,
          lastMessage: userMessage,
          clientName: senderName || existingContact.clientName,
          updatedAt: new Date(),
        })
        .where(eq(pipelineContacts.id, existingContact.id));
    } else {
      await db.insert(pipelineContacts).values({
        userId: session.userId,
        assistantId: session.assistantId,
        stageId: matchedStage.id,
        clientName: senderName || 'Instagram User',
        clientContact: contactId,
        channel: 'instagram',
        lastMessage: userMessage,
        stageName: detectedStageName,
      });
    }
  } catch (error) {
    console.error('[Instagram] Pipeline contact error:', error);
  }
}

export function getInstagramStatus(userId: string, assistantId: number): {
  status: string;
  username: string | null;
  error?: string;
} {
  const sessionKey = getSessionKey(userId, assistantId);
  const session = sessions.get(sessionKey);

  if (!session) {
    return { status: 'not_connected', username: null };
  }

  return {
    status: session.status,
    username: session.username,
    error: session.error,
  };
}

export async function disconnectInstagram(userId: string, assistantId: number): Promise<boolean> {
  const sessionKey = getSessionKey(userId, assistantId);
  const session = sessions.get(sessionKey);

  if (!session) return false;

  try {
    stopPolling(session);
    try {
      await session.ig.account.logout();
    } catch (e) {
      console.log('[Instagram] Logout error (non-critical):', (e as any).message);
    }
    sessions.delete(sessionKey);
    console.log(`[Instagram] Disconnected @${session.username}`);
    return true;
  } catch (error) {
    console.error('[Instagram] Disconnect error:', error);
    sessions.delete(sessionKey);
    return false;
  }
}

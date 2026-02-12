import type { Express, Request, Response } from "express";
import { createServer, type Server } from "http";
import {
  insertAssistantSchema,
  assistants,
  knowledgeBaseFiles,
  chatLogs,
  pipelineStages,
  pipelineContacts,
  insertPipelineStageSchema,
  products,
  type Assistant,
  type InsertAssistant,
} from "@shared/schema";
import {
  setupAuth,
  registerAuthRoutes,
  isAuthenticated,
} from "./replit_integrations/auth";
import { db } from "./db";
import { eq, and, desc, asc } from "drizzle-orm";
import {
  createWhatsAppSession,
  getSessionStatus,
  disconnectSession,
  getAllUserSessions,
} from "./whatsapp";
import multer from "multer";
import { parse as csvParse } from "csv-parse/sync";
import * as XLSX from "xlsx";

// Partial schema for updates - all fields optional
const updateAssistantSchema = insertAssistantSchema.partial();

// Helper to get user ID from request
function getUserId(req: Request): string {
  const userId = (req.user as any)?.claims?.sub;
  return typeof userId === "string" ? userId : String(userId);
}

// Helper function to call Gemini API using fetch
async function callGeminiAPI(messages: any[], streaming = false): Promise<any> {
  const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;

  if (!baseUrl || !apiKey) {
    throw new Error("Missing AI configuration: BASE_URL or API_KEY not set");
  }

  const endpoint = streaming ? "streamGenerateContent" : "generateContent";
  const url = `${baseUrl}/models/gemini-2.5-flash:${endpoint}?key=${apiKey}`;

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: messages,
      generationConfig: {
        temperature: 0.7,
        topK: 40,
        topP: 0.95,
        maxOutputTokens: 2048,
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Gemini API Error:", response.status, errorText);
    throw new Error(`API request failed: ${response.status} - ${errorText}`);
  }

  return response;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  // Setup authentication FIRST (before other routes)
  await setupAuth(app);
  registerAuthRoutes(app);

  // ============ ASSISTANTS API (Protected) ============

  // Get all assistants for the current user
  app.get(
    "/api/assistants",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req);
        const userAssistants = await db
          .select()
          .from(assistants)
          .where(eq(assistants.userId, userId))
          .orderBy(desc(assistants.createdAt));
        res.json(userAssistants);
      } catch (error) {
        console.error("Error fetching assistants:", error);
        res.status(500).json({ error: "Failed to fetch assistants" });
      }
    },
  );

  // Get single assistant (only if owned by user)
  app.get(
    "/api/assistants/:id",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const id = parseInt(req.params.id);
        const userId = getUserId(req);

        const [assistant] = await db
          .select()
          .from(assistants)
          .where(and(eq(assistants.id, id), eq(assistants.userId, userId)));

        if (!assistant) {
          return res.status(404).json({ error: "Assistant not found" });
        }
        res.json(assistant);
      } catch (error) {
        console.error("Error fetching assistant:", error);
        res.status(500).json({ error: "Failed to fetch assistant" });
      }
    },
  );

  // Create new assistant
  app.post(
    "/api/assistants",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req);

        // Validate request body with Zod
        const validationResult = insertAssistantSchema.safeParse({
          ...req.body,
          userId,
        });
        if (!validationResult.success) {
          return res.status(400).json({
            error: "Validation failed",
            details: validationResult.error.format(),
          });
        }

        const [created] = await db
          .insert(assistants)
          .values(validationResult.data)
          .returning();

        res.status(201).json(created);
      } catch (error) {
        console.error("Error creating assistant:", error);
        res.status(500).json({ error: "Failed to create assistant" });
      }
    },
  );

  // Update assistant (only if owned by user)
  app.patch(
    "/api/assistants/:id",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const id = parseInt(req.params.id);
        const userId = getUserId(req);

        // Check ownership first
        const [existing] = await db
          .select()
          .from(assistants)
          .where(and(eq(assistants.id, id), eq(assistants.userId, userId)));

        if (!existing) {
          return res.status(404).json({ error: "Assistant not found" });
        }

        // Remove id, userId, createdAt from update data
        const { id: _, userId: __, createdAt: ___, ...updateData } = req.body;

        // Validate with partial schema
        const validationResult = updateAssistantSchema.safeParse(updateData);
        if (!validationResult.success) {
          return res.status(400).json({
            error: "Validation failed",
            details: validationResult.error.format(),
          });
        }

        const [updated] = await db
          .update(assistants)
          .set(validationResult.data)
          .where(and(eq(assistants.id, id), eq(assistants.userId, userId)))
          .returning();

        res.json(updated);
      } catch (error) {
        console.error("Error updating assistant:", error);
        res.status(500).json({ error: "Failed to update assistant" });
      }
    },
  );

  // Delete assistant (only if owned by user)
  app.delete(
    "/api/assistants/:id",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const id = parseInt(req.params.id);
        const userId = getUserId(req);

        await db
          .delete(assistants)
          .where(and(eq(assistants.id, id), eq(assistants.userId, userId)));

        res.status(204).send();
      } catch (error) {
        console.error("Error deleting assistant:", error);
        res.status(500).json({ error: "Failed to delete assistant" });
      }
    },
  );

  // ============ AI CHAT API (Protected) ============

  // Chat with assistant - FIXED VERSION
  app.post(
    "/api/assistants/:id/chat",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const assistantId = parseInt(req.params.id);
        const userId = getUserId(req);
        const { messages } = req.body;

        if (!messages || !Array.isArray(messages)) {
          return res.status(400).json({ error: "Messages array required" });
        }

        // Get assistant (only if owned by user)
        const [assistant] = await db
          .select()
          .from(assistants)
          .where(
            and(eq(assistants.id, assistantId), eq(assistants.userId, userId)),
          );

        if (!assistant) {
          return res.status(404).json({ error: "Assistant not found" });
        }

        const systemPrompt = await buildSystemPrompt(assistant);

        const chatMessages = [
          { role: "user", parts: [{ text: systemPrompt }] },
          {
            role: "model",
            parts: [
              {
                text: "Understood. I will act according to these instructions.",
              },
            ],
          },
          ...messages.map((m: any) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
          })),
        ];

        // FIXED: Use fetch API instead of GoogleGenAI SDK
        const response = await callGeminiAPI(chatMessages);
        const data = await response.json();
        const responseText =
          data.candidates?.[0]?.content?.parts?.[0]?.text ||
          "Sorry, I couldn't generate a response.";

        const lastUserMessage = messages
          .filter((m: any) => m.role === "user")
          .pop();
        if (lastUserMessage) {
          try {
            await db.insert(chatLogs).values({
              assistantId,
              userId,
              channel: "web",
              senderName: null,
              senderContact: null,
              userMessage: lastUserMessage.content,
              aiResponse: responseText,
            });
          } catch (logError) {
            console.error("Error saving chat log:", logError);
          }
        }

        const detectedStage = extractStageFromResponse(responseText);
        if (detectedStage && lastUserMessage) {
          saveOrUpdatePipelineContact({
            assistantId,
            userId,
            channel: "web",
            clientName: null,
            clientContact: `web_user_${userId}`,
            stageName: detectedStage,
            lastMessage: lastUserMessage.content,
          });
        }

        res.json({ content: responseText });
      } catch (error) {
        console.error("Error in chat:", error);
        res.status(500).json({ error: "Failed to get AI response" });
      }
    },
  );

  // ============ AI BUILDER API (Protected) ============

  // AI Interview for builder - FIXED VERSION
  app.post(
    "/api/ai/interview",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { history, name, role } = req.body;

        if (!name || !role) {
          return res.status(400).json({ error: "Name and role are required" });
        }

        const systemPrompt = `You are an AI Architect helping to design an AI assistant named "${name}" with role "${role}".
Your job is to interview the user to gather information about:
1. What specific goals this assistant should achieve
2. What personality and tone it should have
3. What knowledge it needs
4. What scenarios it should handle

Ask ONE focused question at a time. Be concise and professional.
After gathering enough information (usually 4-5 exchanges), respond with "CONSTRUCT_READY" at the end of your message to signal that you have enough information.

Keep questions in Russian if the user responds in Russian.`;

        const messages = [
          { role: "user", parts: [{ text: systemPrompt }] },
          {
            role: "model",
            parts: [
              {
                text: "Understood. I'll help design this assistant through an interview.",
              },
            ],
          },
        ];

        if (!history || history.length === 0) {
          messages.push({
            role: "user",
            parts: [
              {
                text: `Start the interview for assistant "${name}" with role "${role}"`,
              },
            ],
          });
        } else {
          history.forEach((h: any) => {
            messages.push({
              role: h.role === "model" ? "model" : "user",
              parts: [{ text: h.content }],
            });
          });
        }

        // FIXED: Use fetch API
        const response = await callGeminiAPI(messages);
        const data = await response.json();
        const responseText =
          data.candidates?.[0]?.content?.parts?.[0]?.text || "";

        res.json({ content: responseText });
      } catch (error) {
        console.error("Error in interview:", error);
        res.status(500).json({ error: "Failed to run interview" });
      }
    },
  );

  // Synthesize assistant from interview - FIXED VERSION
  app.post(
    "/api/ai/synthesize",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { history, name, role } = req.body;

        if (!history || !Array.isArray(history)) {
          return res.status(400).json({ error: "History array required" });
        }

        const prompt = `Based on the following interview, create a complete assistant profile.

Interview history:
${history.map((h: any) => `${h.role}: ${h.content}`).join("\n")}

Create a JSON response with these fields:
- goals: string (the main objectives)
- personality: string (tone and communication style)
- knowledgeBase: string[] (key knowledge areas as array)
- scenarios: string (handling rules and special cases)

Respond ONLY with valid JSON, no markdown.`;

        // FIXED: Use fetch API
        const response = await callGeminiAPI([
          { role: "user", parts: [{ text: prompt }] },
        ]);

        const data = await response.json();
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
        const cleaned = text
          .replace(/```json\n?/g, "")
          .replace(/```\n?/g, "")
          .trim();

        try {
          const result = JSON.parse(cleaned);
          res.json(result);
        } catch (parseError) {
          res.json({
            goals: "Help users with their tasks",
            personality: "Professional and helpful",
            knowledgeBase: [],
            scenarios: "",
          });
        }
      } catch (error) {
        console.error("Error in synthesize:", error);
        res.status(500).json({ error: "Failed to synthesize assistant" });
      }
    },
  );

  // Crawl website for knowledge - FIXED VERSION
  app.post(
    "/api/ai/crawl",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const { url } = req.body;

        if (!url) {
          return res.status(400).json({ error: "URL is required" });
        }

        const prompt = `Analyze this website URL and extract key information that would be useful for a customer support AI assistant: ${url}

Provide a summary of:
1. What the company/product does
2. Key features and services
3. Common FAQ topics
4. Contact information if available

Format as plain text suitable for an AI knowledge base.`;

        // FIXED: Use fetch API
        const response = await callGeminiAPI([
          { role: "user", parts: [{ text: prompt }] },
        ]);

        const data = await response.json();
        const responseText =
          data.candidates?.[0]?.content?.parts?.[0]?.text || "";

        res.json({ content: responseText });
      } catch (error) {
        console.error("Error crawling:", error);
        res.status(500).json({ error: "Failed to analyze website" });
      }
    },
  );

  // ============ PUBLIC ASSISTANT API (No Auth Required) ============

  // Get public assistant info (for embed/share pages)
  app.get("/api/public/assistants/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);

      const [assistant] = await db
        .select()
        .from(assistants)
        .where(eq(assistants.id, id));

      if (!assistant) {
        return res.status(404).json({ error: "Assistant not found" });
      }

      // Return only public info (no user-specific data)
      res.json({
        id: assistant.id,
        name: assistant.name,
        role: assistant.role,
        type: assistant.type,
        personality: assistant.personality,
      });
    } catch (error) {
      console.error("Error fetching public assistant:", error);
      res.status(500).json({ error: "Failed to fetch assistant" });
    }
  });

  // Public chat with assistant (for embed/share pages) - FIXED VERSION
  app.post(
    "/api/public/assistants/:id/chat",
    async (req: Request, res: Response) => {
      try {
        const assistantId = parseInt(req.params.id);
        const { messages, visitorName, visitorContact } = req.body;

        if (!messages || !Array.isArray(messages)) {
          return res.status(400).json({ error: "Messages array required" });
        }

        const [assistant] = await db
          .select()
          .from(assistants)
          .where(eq(assistants.id, assistantId));

        if (!assistant) {
          return res.status(404).json({ error: "Assistant not found" });
        }

        const systemPrompt = await buildSystemPrompt(assistant);

        const chatMessages = [
          { role: "user", parts: [{ text: systemPrompt }] },
          {
            role: "model",
            parts: [
              {
                text: "Understood. I will act according to these instructions.",
              },
            ],
          },
          ...messages.map((m: any) => ({
            role: m.role === "assistant" ? "model" : "user",
            parts: [{ text: m.content }],
          })),
        ];

        // FIXED: Use fetch API
        const response = await callGeminiAPI(chatMessages);
        const data = await response.json();
        const responseText =
          data.candidates?.[0]?.content?.parts?.[0]?.text ||
          "Sorry, I couldn't generate a response.";

        const senderName = visitorName || null;
        const senderContact = visitorContact || null;

        const lastUserMessage = messages
          .filter((m: any) => m.role === "user")
          .pop();
        if (lastUserMessage) {
          try {
            await db.insert(chatLogs).values({
              assistantId,
              userId: assistant.userId,
              channel: "embed",
              senderName,
              senderContact,
              userMessage: lastUserMessage.content,
              aiResponse: responseText,
            });
          } catch (logError) {
            console.error("Error saving public chat log:", logError);
          }
        }

        const detectedStage = extractStageFromResponse(responseText);
        if (detectedStage && lastUserMessage) {
          saveOrUpdatePipelineContact({
            assistantId,
            userId: assistant.userId,
            channel: "embed",
            clientName: senderName,
            clientContact: senderContact || `embed_visitor_${Date.now()}`,
            stageName: detectedStage,
            lastMessage: lastUserMessage.content,
          });
        }

        res.json({ content: responseText });
      } catch (error) {
        console.error("Error in public chat:", error);
        res.status(500).json({ error: "Failed to get AI response" });
      }
    },
  );

  // Get published assistants (public endpoint for marketplace)
  app.get(
    "/api/marketplace/assistants",
    async (req: Request, res: Response) => {
      try {
        const published = await db
          .select()
          .from(assistants)
          .where(eq(assistants.isPublished, true))
          .orderBy(desc(assistants.createdAt));
        res.json(published);
      } catch (error) {
        console.error("Error fetching marketplace:", error);
        res.status(500).json({ error: "Failed to fetch marketplace" });
      }
    },
  );

  // ============ WHATSAPP INTEGRATION API ============

  // Connect WhatsApp for an assistant
  app.post(
    "/api/whatsapp/connect",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req);
        const { assistantId } = req.body;

        if (!assistantId) {
          return res.status(400).json({ error: "Assistant ID is required" });
        }

        // Verify assistant belongs to user
        const [assistant] = await db
          .select()
          .from(assistants)
          .where(
            and(eq(assistants.id, assistantId), eq(assistants.userId, userId)),
          );

        if (!assistant) {
          return res.status(404).json({ error: "Assistant not found" });
        }

        const result = await createWhatsAppSession(userId, assistantId);

        if (result.success) {
          res.json({
            success: true,
            qrCode: result.qrCode,
            message: result.qrCode
              ? "Отсканируйте QR-код в WhatsApp: Настройки → Связанные устройства → Привязать устройство"
              : "Сессия уже активна",
          });
        } else {
          res.status(500).json({ success: false, error: result.error });
        }
      } catch (error) {
        console.error("Error connecting WhatsApp:", error);
        res.status(500).json({ error: "Failed to connect WhatsApp" });
      }
    },
  );

  // Get WhatsApp session status
  app.get(
    "/api/whatsapp/status/:assistantId",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req);
        const assistantId = parseInt(req.params.assistantId);

        // Verify assistant belongs to user
        const [assistant] = await db
          .select()
          .from(assistants)
          .where(
            and(eq(assistants.id, assistantId), eq(assistants.userId, userId)),
          );

        if (!assistant) {
          return res.status(404).json({ error: "Assistant not found" });
        }

        const status = getSessionStatus(userId, assistantId);
        res.json(status);
      } catch (error) {
        console.error("Error getting WhatsApp status:", error);
        res.status(500).json({ error: "Failed to get status" });
      }
    },
  );

  // Disconnect WhatsApp session
  app.post(
    "/api/whatsapp/disconnect",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req);
        const { assistantId } = req.body;

        if (!assistantId) {
          return res.status(400).json({ error: "Assistant ID is required" });
        }

        // Verify assistant belongs to user
        const [assistant] = await db
          .select()
          .from(assistants)
          .where(
            and(eq(assistants.id, assistantId), eq(assistants.userId, userId)),
          );

        if (!assistant) {
          return res.status(404).json({ error: "Assistant not found" });
        }

        const success = await disconnectSession(userId, assistantId);
        res.json({ success });
      } catch (error) {
        console.error("Error disconnecting WhatsApp:", error);
        res.status(500).json({ error: "Failed to disconnect" });
      }
    },
  );

  // Get all WhatsApp sessions for user
  app.get(
    "/api/whatsapp/sessions",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req);
        const sessions = getAllUserSessions(userId);
        res.json(sessions);
      } catch (error) {
        console.error("Error getting WhatsApp sessions:", error);
        res.status(500).json({ error: "Failed to get sessions" });
      }
    },
  );

  // ============ INSTAGRAM INTEGRATION API ============

  app.post(
    "/api/instagram/connect",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req);
        const { assistantId, username, password } = req.body;

        if (!assistantId || !username || !password) {
          return res.status(400).json({
            error: "Assistant ID, username, and password are required",
          });
        }

        const [assistant] = await db
          .select()
          .from(assistants)
          .where(
            and(eq(assistants.id, assistantId), eq(assistants.userId, userId)),
          );

        if (!assistant) {
          return res.status(404).json({ error: "Assistant not found" });
        }

        const { connectInstagram } = await import("./instagram");
        const result = await connectInstagram(
          userId,
          assistantId,
          username,
          password,
        );

        if (result.success) {
          const updatedConfigs = {
            ...(assistant.integrationConfigs || {}),
            instagram: {
              platformId: "instagram",
              isEnabled: true,
              username,
              connectedAt: new Date().toISOString(),
            },
          };

          const updatedIntegrations = [
            ...((assistant.integrations as string[]) || []).filter(
              (i: string) => i !== "instagram",
            ),
            "instagram",
          ];

          await db
            .update(assistants)
            .set({
              integrationConfigs: updatedConfigs,
              integrations: updatedIntegrations,
            })
            .where(eq(assistants.id, assistantId));
        }

        res.json(result);
      } catch (error) {
        console.error("Error connecting Instagram:", error);
        res.status(500).json({ error: "Failed to connect Instagram" });
      }
    },
  );

  app.get(
    "/api/instagram/status/:assistantId",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req);
        const assistantId = parseInt(req.params.assistantId);

        const [assistant] = await db
          .select()
          .from(assistants)
          .where(
            and(eq(assistants.id, assistantId), eq(assistants.userId, userId)),
          );

        if (!assistant) {
          return res.status(404).json({ error: "Assistant not found" });
        }

        const { getInstagramStatus } = await import("./instagram");
        const sessionStatus = getInstagramStatus(userId, assistantId);

        if (sessionStatus.status === "connected") {
          res.json(sessionStatus);
        } else {
          const igConfig = (assistant.integrationConfigs as any)?.instagram;
          if (igConfig?.isEnabled) {
            res.json({
              status: "saved_not_active",
              username: igConfig.username,
              error: "Session expired. Please reconnect.",
            });
          } else {
            res.json({ status: "not_connected", username: null });
          }
        }
      } catch (error) {
        console.error("Error getting Instagram status:", error);
        res.status(500).json({ error: "Failed to get status" });
      }
    },
  );

  app.post(
    "/api/instagram/disconnect",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req);
        const { assistantId } = req.body;

        if (!assistantId) {
          return res.status(400).json({ error: "Assistant ID is required" });
        }

        const [assistant] = await db
          .select()
          .from(assistants)
          .where(
            and(eq(assistants.id, assistantId), eq(assistants.userId, userId)),
          );

        if (!assistant) {
          return res.status(404).json({ error: "Assistant not found" });
        }

        const { disconnectInstagram } = await import("./instagram");
        await disconnectInstagram(userId, assistantId);

        const updatedConfigs = {
          ...(assistant.integrationConfigs || {}),
          instagram: {
            platformId: "instagram",
            isEnabled: false,
            username: null,
          },
        };

        const updatedIntegrations = (
          (assistant.integrations as string[]) || []
        ).filter((i: string) => i !== "instagram");

        await db
          .update(assistants)
          .set({
            integrationConfigs: updatedConfigs,
            integrations: updatedIntegrations,
          })
          .where(eq(assistants.id, assistantId));

        res.json({ success: true });
      } catch (error) {
        console.error("Error disconnecting Instagram:", error);
        res.status(500).json({ error: "Failed to disconnect" });
      }
    },
  );

  // ============ KNOWLEDGE BASE FILES API ============

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const allowed = [
        "text/csv",
        "text/plain",
        "application/json",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
      ];
      if (
        allowed.includes(file.mimetype) ||
        file.originalname.endsWith(".csv") ||
        file.originalname.endsWith(".txt") ||
        file.originalname.endsWith(".json") ||
        file.originalname.endsWith(".xlsx") ||
        file.originalname.endsWith(".xls")
      ) {
        cb(null, true);
      } else {
        cb(new Error("Unsupported file type. Use CSV, TXT, JSON, or XLSX."));
      }
    },
  });

  function parseFileContent(
    buffer: Buffer,
    fileName: string,
    mimetype: string,
  ): { content: string; rowCount: number } {
    const ext = fileName.split(".").pop()?.toLowerCase();

    if (ext === "csv" || mimetype === "text/csv") {
      const text = buffer.toString("utf-8");
      const records = csvParse(text, {
        columns: true,
        skip_empty_lines: true,
        relax_column_count: true,
      }) as Record<string, string>[];
      const content = records
        .map((row: Record<string, string>) => {
          return Object.entries(row)
            .map(([key, val]) => `${key}: ${val}`)
            .join(" | ");
        })
        .join("\n");
      return { content, rowCount: records.length };
    }

    if (
      ext === "xlsx" ||
      ext === "xls" ||
      mimetype.includes("spreadsheet") ||
      mimetype.includes("excel")
    ) {
      const workbook = XLSX.read(buffer, { type: "buffer" });
      let allContent = "";
      let totalRows = 0;
      for (const sheetName of workbook.SheetNames) {
        const sheet = workbook.Sheets[sheetName];
        const jsonData = XLSX.utils.sheet_to_json<Record<string, any>>(sheet);
        totalRows += jsonData.length;
        const sheetContent = jsonData
          .map((row) => {
            return Object.entries(row)
              .map(([key, val]) => `${key}: ${val}`)
              .join(" | ");
          })
          .join("\n");
        allContent += (allContent ? "\n" : "") + sheetContent;
      }
      return { content: allContent, rowCount: totalRows };
    }

    if (ext === "json" || mimetype === "application/json") {
      const text = buffer.toString("utf-8");
      const parsed = JSON.parse(text);
      const items = Array.isArray(parsed) ? parsed : [parsed];
      const content = items
        .map((item: any) => {
          if (typeof item === "string") return item;
          return Object.entries(item)
            .map(
              ([key, val]) =>
                `${key}: ${typeof val === "object" ? JSON.stringify(val) : val}`,
            )
            .join(" | ");
        })
        .join("\n");
      return { content, rowCount: items.length };
    }

    const text = buffer.toString("utf-8");
    const lines = text.split("\n").filter((l) => l.trim());
    return { content: text, rowCount: lines.length };
  }

  app.post(
    "/api/knowledge-base/upload",
    isAuthenticated,
    upload.single("file"),
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req);
        const assistantId = parseInt(req.body.assistantId);

        if (!assistantId || !req.file) {
          return res
            .status(400)
            .json({ error: "File and assistant ID are required" });
        }

        const [assistant] = await db
          .select()
          .from(assistants)
          .where(
            and(eq(assistants.id, assistantId), eq(assistants.userId, userId)),
          );

        if (!assistant) {
          return res.status(404).json({ error: "Assistant not found" });
        }

        const { content, rowCount } = parseFileContent(
          req.file.buffer,
          req.file.originalname,
          req.file.mimetype,
        );

        const [file] = await db
          .insert(knowledgeBaseFiles)
          .values({
            assistantId,
            userId,
            fileName: req.file.originalname,
            fileType:
              req.file.originalname.split(".").pop()?.toLowerCase() ||
              "unknown",
            fileSize: req.file.size,
            rowCount,
            content,
            status: "ready",
          })
          .returning();

        res.status(201).json(file);
      } catch (error: any) {
        console.error("Error uploading knowledge base file:", error);
        if (error.message?.includes("Unsupported file type")) {
          return res.status(400).json({ error: error.message });
        }
        res.status(500).json({ error: "Failed to upload file" });
      }
    },
  );

  app.get(
    "/api/knowledge-base/:assistantId",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req);
        const assistantId = parseInt(req.params.assistantId);

        const [assistant] = await db
          .select()
          .from(assistants)
          .where(
            and(eq(assistants.id, assistantId), eq(assistants.userId, userId)),
          );

        if (!assistant) {
          return res.status(404).json({ error: "Assistant not found" });
        }

        const files = await db
          .select({
            id: knowledgeBaseFiles.id,
            assistantId: knowledgeBaseFiles.assistantId,
            fileName: knowledgeBaseFiles.fileName,
            fileType: knowledgeBaseFiles.fileType,
            fileSize: knowledgeBaseFiles.fileSize,
            rowCount: knowledgeBaseFiles.rowCount,
            status: knowledgeBaseFiles.status,
            createdAt: knowledgeBaseFiles.createdAt,
          })
          .from(knowledgeBaseFiles)
          .where(
            and(
              eq(knowledgeBaseFiles.assistantId, assistantId),
              eq(knowledgeBaseFiles.userId, userId),
            ),
          )
          .orderBy(desc(knowledgeBaseFiles.createdAt));

        res.json(files);
      } catch (error) {
        console.error("Error fetching knowledge base files:", error);
        res.status(500).json({ error: "Failed to fetch files" });
      }
    },
  );

  app.get(
    "/api/knowledge-base/file/:fileId/preview",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req);
        const fileId = parseInt(req.params.fileId);

        const [file] = await db
          .select()
          .from(knowledgeBaseFiles)
          .where(
            and(
              eq(knowledgeBaseFiles.id, fileId),
              eq(knowledgeBaseFiles.userId, userId),
            ),
          );

        if (!file) {
          return res.status(404).json({ error: "File not found" });
        }

        const lines = file.content.split("\n");
        const preview = lines.slice(0, 50).join("\n");
        res.json({ preview, totalLines: lines.length });
      } catch (error) {
        console.error("Error previewing file:", error);
        res.status(500).json({ error: "Failed to preview file" });
      }
    },
  );

  app.delete(
    "/api/knowledge-base/file/:fileId",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req);
        const fileId = parseInt(req.params.fileId);

        const [file] = await db
          .select()
          .from(knowledgeBaseFiles)
          .where(
            and(
              eq(knowledgeBaseFiles.id, fileId),
              eq(knowledgeBaseFiles.userId, userId),
            ),
          );

        if (!file) {
          return res.status(404).json({ error: "File not found" });
        }

        await db
          .delete(knowledgeBaseFiles)
          .where(eq(knowledgeBaseFiles.id, fileId));
        res.json({ success: true });
      } catch (error) {
        console.error("Error deleting knowledge base file:", error);
        res.status(500).json({ error: "Failed to delete file" });
      }
    },
  );

  // ============ PRODUCTS API ============

  app.get(
    "/api/products/:assistantId",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req);
        const assistantId = parseInt(req.params.assistantId);

        const [assistant] = await db
          .select()
          .from(assistants)
          .where(
            and(eq(assistants.id, assistantId), eq(assistants.userId, userId)),
          );

        if (!assistant) {
          return res.status(404).json({ error: "Assistant not found" });
        }

        const productList = await db
          .select()
          .from(products)
          .where(
            and(
              eq(products.assistantId, assistantId),
              eq(products.userId, userId),
            ),
          )
          .orderBy(desc(products.createdAt));

        res.json(productList);
      } catch (error) {
        console.error("Error fetching products:", error);
        res.status(500).json({ error: "Failed to fetch products" });
      }
    },
  );

  app.post(
    "/api/products",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req);
        const {
          assistantId,
          type,
          name,
          description,
          price,
          currency,
          available,
          characteristics,
          photoData,
        } = req.body;

        if (!assistantId || !name || !price) {
          return res
            .status(400)
            .json({ error: "assistantId, name, and price are required" });
        }

        const validType = type === "service" ? "service" : "product";
        const parsedAssistantId =
          typeof assistantId === "string"
            ? parseInt(assistantId)
            : Number(assistantId);

        if (isNaN(parsedAssistantId)) {
          return res.status(400).json({ error: "Invalid assistantId" });
        }

        const [assistant] = await db
          .select()
          .from(assistants)
          .where(
            and(
              eq(assistants.id, parsedAssistantId),
              eq(assistants.userId, userId),
            ),
          );

        if (!assistant) {
          return res.status(404).json({ error: "Assistant not found" });
        }

        const [product] = await db
          .insert(products)
          .values({
            assistantId: parsedAssistantId,
            userId,
            type: validType,
            name,
            description: description || null,
            price: String(price),
            currency: currency || "USD",
            available: available !== false,
            characteristics: characteristics || null,
            photoData: photoData || null,
          })
          .returning();

        res.status(201).json(product);
      } catch (error) {
        console.error("Error creating product:", error);
        res.status(500).json({ error: "Failed to create product" });
      }
    },
  );

  app.patch(
    "/api/products/:id",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req);
        const productId = parseInt(req.params.id);
        const {
          type,
          name,
          description,
          price,
          currency,
          available,
          characteristics,
          photoData,
        } = req.body;

        const [existing] = await db
          .select()
          .from(products)
          .where(and(eq(products.id, productId), eq(products.userId, userId)));

        if (!existing) {
          return res.status(404).json({ error: "Product not found" });
        }

        const updates: Record<string, any> = {};
        if (type !== undefined)
          updates.type = type === "service" ? "service" : "product";
        if (name !== undefined) updates.name = name;
        if (description !== undefined) updates.description = description;
        if (price !== undefined) updates.price = String(price);
        if (currency !== undefined) updates.currency = currency;
        if (available !== undefined) updates.available = available;
        if (characteristics !== undefined)
          updates.characteristics = characteristics;
        if (photoData !== undefined) updates.photoData = photoData;

        const [updated] = await db
          .update(products)
          .set(updates)
          .where(and(eq(products.id, productId), eq(products.userId, userId)))
          .returning();

        res.json(updated);
      } catch (error) {
        console.error("Error updating product:", error);
        res.status(500).json({ error: "Failed to update product" });
      }
    },
  );

  app.delete(
    "/api/products/:id",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req);
        const productId = parseInt(req.params.id);

        const [existing] = await db
          .select()
          .from(products)
          .where(and(eq(products.id, productId), eq(products.userId, userId)));

        if (!existing) {
          return res.status(404).json({ error: "Product not found" });
        }

        await db.delete(products).where(eq(products.id, productId));
        res.json({ success: true });
      } catch (error) {
        console.error("Error deleting product:", error);
        res.status(500).json({ error: "Failed to delete product" });
      }
    },
  );

  // Product recognition - FIXED VERSION
  app.post(
    "/api/products/recognize",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req);
        const { assistantId, imageData } = req.body;

        if (!assistantId || !imageData) {
          return res
            .status(400)
            .json({ error: "assistantId and imageData are required" });
        }

        const [assistant] = await db
          .select()
          .from(assistants)
          .where(
            and(
              eq(assistants.id, parseInt(assistantId)),
              eq(assistants.userId, userId),
            ),
          );

        if (!assistant) {
          return res.status(404).json({ error: "Assistant not found" });
        }

        const productList = await db
          .select()
          .from(products)
          .where(eq(products.assistantId, parseInt(assistantId)));

        const productDescriptions = productList
          .map(
            (p) =>
              `ID: ${p.id}, Name: "${p.name}", Price: ${p.price} ${p.currency}, Available: ${p.available ? "Yes" : "No"}, Description: ${p.description || "N/A"}, Characteristics: ${p.characteristics || "N/A"}`,
          )
          .join("\n");

        const base64Data = imageData.replace(/^data:image\/[^;]+;base64,/, "");
        const mimeMatch = imageData.match(/^data:(image\/[^;]+);base64,/);
        const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";

        const recognitionPrompt = `You are a product recognition assistant. Analyze the provided image and compare it with the product catalog below.

PRODUCT CATALOG:
${productDescriptions || "No products in catalog."}

TASK:
1. Describe what you see in the image
2. Determine if any product from the catalog matches what is shown in the image
3. If a match is found, provide the product details (name, price, availability)
4. If no match is found, say so clearly

Respond in Russian. Be concise and helpful.`;

        // FIXED: Use fetch API
        const response = await callGeminiAPI([
          {
            role: "user",
            parts: [
              { text: recognitionPrompt },
              { inlineData: { data: base64Data, mimeType } },
            ],
          },
        ]);

        const data = await response.json();
        const responseText =
          data.candidates?.[0]?.content?.parts?.[0]?.text ||
          "Не удалось распознать изображение.";

        res.json({ result: responseText });
      } catch (error) {
        console.error("Error recognizing product:", error);
        res.status(500).json({ error: "Failed to recognize product" });
      }
    },
  );

  // Public product recognition for chat - FIXED VERSION
  app.post(
    "/api/public/assistants/:id/recognize",
    async (req: Request, res: Response) => {
      try {
        const assistantId = parseInt(req.params.id);
        const { imageData } = req.body;

        if (!imageData) {
          return res.status(400).json({ error: "imageData is required" });
        }

        const [assistant] = await db
          .select()
          .from(assistants)
          .where(eq(assistants.id, assistantId));

        if (!assistant) {
          return res.status(404).json({ error: "Assistant not found" });
        }

        const productList = await db
          .select()
          .from(products)
          .where(eq(products.assistantId, assistantId));

        const productDescriptions = productList
          .map(
            (p) =>
              `Name: "${p.name}", Price: ${p.price} ${p.currency}, Available: ${p.available ? "Yes" : "No"}, Description: ${p.description || "N/A"}, Characteristics: ${p.characteristics || "N/A"}`,
          )
          .join("\n");

        const base64Data = imageData.replace(/^data:image\/[^;]+;base64,/, "");
        const mimeMatch = imageData.match(/^data:(image\/[^;]+);base64,/);
        const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";

        const systemPrompt = await buildSystemPrompt(assistant);

        const recognitionPrompt = `${systemPrompt}

The customer has sent a photo. Analyze it and check if any product from your catalog matches what is shown.
If found, provide full details. If not found, politely inform the customer.

PRODUCT CATALOG:
${productDescriptions || "No products available."}`;

        // FIXED: Use fetch API
        const response = await callGeminiAPI([
          {
            role: "user",
            parts: [
              { text: recognitionPrompt },
              { inlineData: { data: base64Data, mimeType } },
            ],
          },
        ]);

        const data = await response.json();
        const responseText =
          data.candidates?.[0]?.content?.parts?.[0]?.text ||
          "Не удалось распознать изображение.";

        res.json({ content: responseText });
      } catch (error) {
        console.error("Error in public product recognition:", error);
        res.status(500).json({ error: "Failed to recognize product" });
      }
    },
  );

  // ============ CHAT MONITORING API ============

  app.get(
    "/api/chat-logs",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req);
        const { channel, assistantId, limit: queryLimit } = req.query;

        const conditions = [eq(chatLogs.userId, userId)];
        if (channel && channel !== "all") {
          conditions.push(eq(chatLogs.channel, channel as string));
        }
        if (assistantId && assistantId !== "all") {
          conditions.push(
            eq(chatLogs.assistantId, parseInt(assistantId as string)),
          );
        }

        const logs = await db
          .select({
            id: chatLogs.id,
            assistantId: chatLogs.assistantId,
            channel: chatLogs.channel,
            senderName: chatLogs.senderName,
            senderContact: chatLogs.senderContact,
            userMessage: chatLogs.userMessage,
            aiResponse: chatLogs.aiResponse,
            createdAt: chatLogs.createdAt,
          })
          .from(chatLogs)
          .where(and(...conditions))
          .orderBy(desc(chatLogs.createdAt))
          .limit(parseInt(queryLimit as string) || 200);

        res.json(logs);
      } catch (error) {
        console.error("Error fetching chat logs:", error);
        res.status(500).json({ error: "Failed to fetch chat logs" });
      }
    },
  );

  app.get(
    "/api/chat-logs/stats",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req);

        const allLogs = await db
          .select({
            id: chatLogs.id,
            channel: chatLogs.channel,
            assistantId: chatLogs.assistantId,
            createdAt: chatLogs.createdAt,
          })
          .from(chatLogs)
          .where(eq(chatLogs.userId, userId));

        const total = allLogs.length;
        const channels: Record<string, number> = {};
        const assistantIds = new Set<number>();

        const now = new Date();
        const todayStart = new Date(
          now.getFullYear(),
          now.getMonth(),
          now.getDate(),
        );
        let todayCount = 0;

        for (const log of allLogs) {
          channels[log.channel] = (channels[log.channel] || 0) + 1;
          assistantIds.add(log.assistantId);
          const logDate = new Date(log.createdAt);
          if (logDate >= todayStart) {
            todayCount++;
          }
        }

        res.json({
          total,
          today: todayCount,
          channels,
          assistantCount: assistantIds.size,
        });
      } catch (error) {
        console.error("Error fetching chat log stats:", error);
        res.status(500).json({ error: "Failed to fetch stats" });
      }
    },
  );

  // ============ PIPELINE STAGES API ============

  app.get(
    "/api/pipeline-stages/:assistantId",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req);
        const assistantId = parseInt(req.params.assistantId);

        const stages = await db
          .select()
          .from(pipelineStages)
          .where(
            and(
              eq(pipelineStages.userId, userId),
              eq(pipelineStages.assistantId, assistantId),
            ),
          )
          .orderBy(pipelineStages.sortOrder);

        res.json(stages);
      } catch (error) {
        console.error("Error fetching pipeline stages:", error);
        res.status(500).json({ error: "Failed to fetch pipeline stages" });
      }
    },
  );

  app.post(
    "/api/pipeline-stages",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req);
        const body = { ...req.body, userId };
        const parsed = insertPipelineStageSchema.parse(body);

        const existing = await db
          .select()
          .from(pipelineStages)
          .where(
            and(
              eq(pipelineStages.userId, userId),
              eq(pipelineStages.assistantId, parsed.assistantId),
            ),
          );

        const nextOrder =
          existing.length > 0
            ? Math.max(...existing.map((s) => s.sortOrder)) + 1
            : 0;

        const [created] = await db
          .insert(pipelineStages)
          .values({ ...parsed, sortOrder: nextOrder })
          .returning();
        res.status(201).json(created);
      } catch (error) {
        console.error("Error creating pipeline stage:", error);
        res.status(400).json({ error: "Failed to create pipeline stage" });
      }
    },
  );

  app.patch(
    "/api/pipeline-stages/:id",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req);
        const stageId = parseInt(req.params.id);

        const [existing] = await db
          .select()
          .from(pipelineStages)
          .where(
            and(
              eq(pipelineStages.id, stageId),
              eq(pipelineStages.userId, userId),
            ),
          );

        if (!existing) {
          return res.status(404).json({ error: "Stage not found" });
        }

        const updateData: Record<string, any> = {};
        if (req.body.name !== undefined) updateData.name = req.body.name;
        if (req.body.description !== undefined)
          updateData.description = req.body.description;
        if (req.body.sortOrder !== undefined)
          updateData.sortOrder = req.body.sortOrder;

        const [updated] = await db
          .update(pipelineStages)
          .set(updateData)
          .where(
            and(
              eq(pipelineStages.id, stageId),
              eq(pipelineStages.userId, userId),
            ),
          )
          .returning();

        res.json(updated);
      } catch (error) {
        console.error("Error updating pipeline stage:", error);
        res.status(500).json({ error: "Failed to update pipeline stage" });
      }
    },
  );

  app.put(
    "/api/pipeline-stages/reorder",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req);
        const { assistantId, stageIds } = req.body;

        if (!assistantId || !Array.isArray(stageIds)) {
          return res
            .status(400)
            .json({ error: "assistantId and stageIds[] required" });
        }

        for (let i = 0; i < stageIds.length; i++) {
          await db
            .update(pipelineStages)
            .set({ sortOrder: i })
            .where(
              and(
                eq(pipelineStages.id, stageIds[i]),
                eq(pipelineStages.userId, userId),
              ),
            );
        }

        const stages = await db
          .select()
          .from(pipelineStages)
          .where(
            and(
              eq(pipelineStages.userId, userId),
              eq(pipelineStages.assistantId, parseInt(assistantId)),
            ),
          )
          .orderBy(pipelineStages.sortOrder);

        res.json(stages);
      } catch (error) {
        console.error("Error reordering stages:", error);
        res.status(500).json({ error: "Failed to reorder stages" });
      }
    },
  );

  app.delete(
    "/api/pipeline-stages/:id",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req);
        const stageId = parseInt(req.params.id);

        const [existing] = await db
          .select()
          .from(pipelineStages)
          .where(
            and(
              eq(pipelineStages.id, stageId),
              eq(pipelineStages.userId, userId),
            ),
          );

        if (!existing) {
          return res.status(404).json({ error: "Stage not found" });
        }

        await db
          .delete(pipelineStages)
          .where(
            and(
              eq(pipelineStages.id, stageId),
              eq(pipelineStages.userId, userId),
            ),
          );
        res.json({ success: true });
      } catch (error) {
        console.error("Error deleting pipeline stage:", error);
        res.status(500).json({ error: "Failed to delete pipeline stage" });
      }
    },
  );

  // ============ PIPELINE CONTACTS API ============

  app.get(
    "/api/pipeline-contacts/:assistantId",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req);
        const assistantId = parseInt(req.params.assistantId);

        const contacts = await db
          .select()
          .from(pipelineContacts)
          .where(
            and(
              eq(pipelineContacts.userId, userId),
              eq(pipelineContacts.assistantId, assistantId),
            ),
          )
          .orderBy(desc(pipelineContacts.updatedAt));

        res.json(contacts);
      } catch (error) {
        console.error("Error fetching pipeline contacts:", error);
        res.status(500).json({ error: "Failed to fetch pipeline contacts" });
      }
    },
  );

  app.delete(
    "/api/pipeline-contacts/:id",
    isAuthenticated,
    async (req: Request, res: Response) => {
      try {
        const userId = getUserId(req);
        const contactId = parseInt(req.params.id);

        await db
          .delete(pipelineContacts)
          .where(
            and(
              eq(pipelineContacts.id, contactId),
              eq(pipelineContacts.userId, userId),
            ),
          );

        res.json({ success: true });
      } catch (error) {
        console.error("Error deleting pipeline contact:", error);
        res.status(500).json({ error: "Failed to delete pipeline contact" });
      }
    },
  );

  return httpServer;
}

function extractStageFromResponse(responseText: string): string | null {
  const match = responseText.match(/\[(?:Стадия|Stage):\s*(.+?)\]/i);
  return match ? match[1].trim() : null;
}

async function saveOrUpdatePipelineContact(params: {
  assistantId: number;
  userId: string;
  channel: string;
  clientName: string | null;
  clientContact: string | null;
  stageName: string;
  lastMessage: string;
}): Promise<void> {
  try {
    const {
      assistantId,
      userId,
      channel,
      clientName,
      clientContact,
      stageName,
      lastMessage,
    } = params;

    const [stage] = await db
      .select()
      .from(pipelineStages)
      .where(
        and(
          eq(pipelineStages.assistantId, assistantId),
          eq(pipelineStages.name, stageName),
        ),
      );

    if (!stage) return;

    const contactIdentifier =
      clientContact || clientName || `${channel}_anonymous_${assistantId}`;

    const [existing] = await db
      .select()
      .from(pipelineContacts)
      .where(
        and(
          eq(pipelineContacts.assistantId, assistantId),
          eq(pipelineContacts.clientContact, contactIdentifier),
        ),
      );

    if (existing) {
      await db
        .update(pipelineContacts)
        .set({
          stageId: stage.id,
          stageName: stageName,
          lastMessage: lastMessage,
          clientName: clientName || existing.clientName,
          updatedAt: new Date(),
        })
        .where(eq(pipelineContacts.id, existing.id));
    } else {
      await db.insert(pipelineContacts).values({
        userId,
        assistantId,
        stageId: stage.id,
        clientName:
          clientName ||
          (channel === "web"
            ? "Веб-пользователь"
            : channel === "whatsapp"
              ? "WhatsApp контакт"
              : "Пользователь"),
        clientContact: contactIdentifier,
        channel,
        lastMessage,
        stageName,
      });
    }
  } catch (error) {
    console.error("Error saving pipeline contact:", error);
  }
}

async function buildSystemPrompt(assistant: Assistant): Promise<string> {
  let prompt = `You are "${assistant.name}", an AI assistant with the following configuration:

Role: ${assistant.role}
${assistant.goals ? `Goals: ${assistant.goals}` : ""}
${assistant.personality ? `Personality: ${assistant.personality}` : ""}
${assistant.scenarios ? `Special Scenarios: ${assistant.scenarios}` : ""}
`;

  if (assistant.knowledgeBase && assistant.knowledgeBase.length > 0) {
    prompt += `\nKnowledge Base:\n${assistant.knowledgeBase.join("\n")}\n`;
  }

  if (assistant.catalog && assistant.catalog.length > 0) {
    prompt += `\nProducts/Services Catalog:\n`;
    assistant.catalog.forEach((item: any) => {
      prompt += `- ${item.name}: ${item.description} (${item.priceOrCategory})\n`;
    });
  }

  const productList = await db
    .select()
    .from(products)
    .where(eq(products.assistantId, assistant.id));

  if (productList.length > 0) {
    prompt += `\n\n=== КАТАЛОГ ТОВАРОВ ===\n`;
    prompt += `У тебя есть следующие товары. Используй эти данные для ответов клиентам:\n\n`;
    for (const p of productList) {
      prompt += `--- Товар: ${p.name} ---\n`;
      prompt += `Цена: ${p.price} ${p.currency}\n`;
      prompt += `В наличии: ${p.available ? "Да" : "Нет"}\n`;
      if (p.description) prompt += `Описание: ${p.description}\n`;
      if (p.characteristics) prompt += `Характеристики: ${p.characteristics}\n`;
      prompt += `\n`;
    }
    prompt += `=== КОНЕЦ КАТАЛОГА ===\n`;
    prompt += `Когда клиент спрашивает о товарах, всегда используй точные данные из каталога: название, цену, наличие, характеристики.\n`;
    prompt += `Если клиент отправляет фото товара, попробуй определить, есть ли похожий товар в каталоге.\n`;
  }

  const kbFiles = await db
    .select()
    .from(knowledgeBaseFiles)
    .where(
      and(
        eq(knowledgeBaseFiles.assistantId, assistant.id),
        eq(knowledgeBaseFiles.status, "ready"),
      ),
    );

  if (kbFiles.length > 0) {
    prompt += `\n\n=== UPLOADED KNOWLEDGE BASE DATA ===\n`;
    prompt += `You have access to the following uploaded data files. Use this data to answer questions accurately:\n\n`;
    for (const file of kbFiles) {
      prompt += `--- File: ${file.fileName} (${file.rowCount} records) ---\n`;
      prompt += file.content + "\n\n";
    }
    prompt += `=== END OF KNOWLEDGE BASE DATA ===\n`;
    prompt += `When answering questions about products, items, or data from the knowledge base, always reference the exact data from the uploaded files. Provide specific details like names, prices, descriptions, etc.\n`;
  }

  const stages = await db
    .select()
    .from(pipelineStages)
    .where(eq(pipelineStages.assistantId, assistant.id))
    .orderBy(asc(pipelineStages.sortOrder));

  if (stages.length > 0) {
    prompt += `\n\n=== ОБЯЗАТЕЛЬНО: СТАДИИ ВОРОНКИ ПРОДАЖ ===\n`;
    prompt += `ВАЖНО! Ты ОБЯЗАН в каждом своём ответе определять текущую стадию клиента в воронке продаж.\n`;
    prompt += `Анализируй контекст разговора и определяй, на какой стадии находится клиент.\n\n`;
    prompt += `Доступные стадии (в порядке продвижения по воронке):\n`;
    for (const stage of stages) {
      prompt += `${stage.sortOrder + 1}. "${stage.name}" — Условия: ${stage.description}\n`;
    }
    prompt += `\nПРАВИЛА (СТРОГО ОБЯЗАТЕЛЬНЫ):\n`;
    prompt += `1. В КАЖДОМ ответе добавляй в самом конце строку: [Стадия: <название стадии>]\n`;
    prompt += `2. Выбирай стадию исходя из того, что клиент сказал и какие условия стадий выполнены\n`;
    prompt += `3. Если клиент только начал разговор, используй первую стадию\n`;
    prompt += `4. НИКОГДА не пропускай строку со стадией — это критически важно для аналитики\n`;
    prompt += `=== КОНЕЦ СТАДИЙ ВОРОНКИ ===\n`;
  }

  prompt += `\nAlways stay in character and respond according to your defined personality and goals.`;

  return prompt;
}

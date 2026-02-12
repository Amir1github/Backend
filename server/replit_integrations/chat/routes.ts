import type { Express, Request, Response } from "express";
import { chatStorage } from "./storage";

/*
  Supported models: gemini-2.5-flash (fast), gemini-2.5-pro (advanced reasoning)
  Usage: Include httpOptions with baseUrl and empty apiVersion when using AI Integrations (required)
  */

// This is using Replit's AI Integrations service, which provides Gemini-compatible API access without requiring your own Gemini API key.

export function registerChatRoutes(app: Express): void {
  // Get all conversations
  app.get("/api/conversations", async (req: Request, res: Response) => {
    try {
      const conversations = await chatStorage.getAllConversations();
      res.json(conversations);
    } catch (error) {
      console.error("Error fetching conversations:", error);
      res.status(500).json({ error: "Failed to fetch conversations" });
    }
  });

  // Get single conversation with messages
  app.get("/api/conversations/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      const conversation = await chatStorage.getConversation(id);
      if (!conversation) {
        return res.status(404).json({ error: "Conversation not found" });
      }
      const messages = await chatStorage.getMessagesByConversation(id);
      res.json({ ...conversation, messages });
    } catch (error) {
      console.error("Error fetching conversation:", error);
      res.status(500).json({ error: "Failed to fetch conversation" });
    }
  });

  // Create new conversation
  app.post("/api/conversations", async (req: Request, res: Response) => {
    try {
      const { title } = req.body;
      const conversation = await chatStorage.createConversation(
        title || "New Chat",
      );
      res.status(201).json(conversation);
    } catch (error) {
      console.error("Error creating conversation:", error);
      res.status(500).json({ error: "Failed to create conversation" });
    }
  });

  // Delete conversation
  app.delete("/api/conversations/:id", async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id);
      await chatStorage.deleteConversation(id);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting conversation:", error);
      res.status(500).json({ error: "Failed to delete conversation" });
    }
  });

  // Send message and get AI response (streaming)
  app.post(
    "/api/conversations/:id/messages",
    async (req: Request, res: Response) => {
      try {
        const conversationId = parseInt(req.params.id);
        const { content } = req.body;

        // 1. Save user message
        await chatStorage.createMessage(conversationId, "user", content);

        // 2. Get chat history
        const messages =
          await chatStorage.getMessagesByConversation(conversationId);

        const chatMessages = messages.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        }));

        // 3. SSE headers
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        // 4. Construct the proper URL
        const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
        const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY!; // ✅ Fixed

        if (!baseUrl || !apiKey) {
          throw new Error(
            "Missing AI configuration: AI_INTEGRATIONS_GEMINI_BASE_URL or AI_INTEGRATIONS_GEMINI_API_KEY not set",
          );
        }

        const url = `${baseUrl}/models/gemini-2.5-flash:streamGenerateContent?key=${apiKey}`;

        console.log("Making request to:", url.replace(apiKey, "***")); // Log for debugging

        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contents: chatMessages,
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
          console.error("API Error:", response.status, errorText);
          throw new Error(
            `API request failed: ${response.status} - ${errorText}`,
          );
        }

        if (!response.body) {
          throw new Error("No response body");
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        let fullResponse = "";

        // 5. Read stream
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split("\n");

          for (const line of lines) {
            if (!line.trim()) continue;

            try {
              const json = JSON.parse(line);
              const text = json.candidates?.[0]?.content?.parts?.[0]?.text;

              if (text) {
                fullResponse += text;
                res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
              }
            } catch (parseError) {
              // Skip invalid JSON chunks
              console.warn("Failed to parse chunk:", line);
            }
          }
        }

        // 6. Save assistant's response
        if (fullResponse) {
          await chatStorage.createMessage(
            conversationId,
            "assistant",
            fullResponse,
          );
        }

        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
      } catch (error) {
        console.error("Chat error:", error);

        if (res.headersSent) {
          res.write(`data: ${JSON.stringify({ error: "AI error" })}\n\n`);
          res.end();
        } else {
          res.status(500).json({ error: "Failed to send message" });
        }
      }
    },
  );
}

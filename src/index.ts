#!/usr/bin/env node

/**
 * This is a template MCP server that implements Santa's wishlist system.
 * It demonstrates core MCP concepts like resources and tools by allowing:
 * - Listing wishes as resources
 * - Reading individual wishes
 * - Creating new wishes via a tool
 * - Summarizing all wishes via a prompt
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { fireproof } from "use-fireproof";

const db = fireproof("mcp_wishlist", { public: true });

/**
 * Type alias for a wish object.
 */
type Wish = {
  _id: string,
  type?: string,
  done: boolean,
  text: string,
  created: Number,
  updated: Number
};

/**
 * Type alias for an elf shopping item
 */
type ElfItem = {
  _id: string,
  type: "elf",
  name: string,
  price: number,
  wishId: string,
  created: Number
};

/**
 * Simple in-memory storage for wishes and elf items.
 * In a real implementation, this would likely be backed by a database.
 */
const wishes: { [id: string]: Wish | ElfItem } = {}

await db.ready()

const onDbEvent = async function () {
  const run = Math.random()
  const fpWishes = await db.query("created", {
    includeDocs: true,
    descending: true,
    limit: 10,
  });
  for (let id in wishes) {
    delete wishes[id]
  }
  for (const row of fpWishes.rows) {
    let wish = row.doc;
    wishes[wish!._id] = wish as Wish | ElfItem
  }
};
onDbEvent();
db.subscribe(onDbEvent);

/**
 * Create an MCP server with capabilities for resources (to list/read wishes),
 * tools (to create new wishes), and prompts (to summarize wishes).
 */
const server = new Server(
  {
    name: "wishlist",
    version: "0.1.0",
  },
  {
    capabilities: {
      resources: { enabled: true },
      tools: { enabled: true },
      prompts: { enabled: true }  // Make it explicitly enabled
    },
  }
);

/**
 * Handler for listing available wishes as resources.
 * Each wish is exposed as a resource with:
 * - A wish:// URI scheme
 * - Plain text MIME type
 * - Human readable name and description (now including the wish title)
 */
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: Object.entries(wishes).map(([id, wish]) => ({
      uri: `wish:///${id}`,
      mimeType: "text/plain",
      name: 'text' in wish ? wish.text : wish.name,
      description: 'text' in wish ? `A Christmas wish: ${wish.text}` : `An elf shopping item: ${wish.name} ($${wish.price})`
    }))
  };
});

/**
 * Handler for reading the contents of a specific wish.
 * Takes a wish:// URI and returns the wish content as plain text.
 */
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const url = new URL(request.params.uri);
  const id = url.pathname.replace(/^\//, '');
  const wish = wishes[id];

  if (!wish) {
    throw new Error(`Item ${id} not found`);
  }

  return {
    contents: [{
      uri: request.params.uri,
      mimeType: "text/plain",
      text: 'text' in wish ? wish.text : `${wish.name} ($${wish.price})`
    }]
  };
});

/**
 * Handler that lists available tools.
 * Exposes tools for creating wishes and elf shopping items.
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "create_wish",
        description: "Create a new Christmas wish",
        inputSchema: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "Content of the wish"
            },
          },
          required: ["text", "done"]
        }
      },
      {
        name: "create_elf_item",
        description: "Create a new elf shopping item",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Name of the item"
            },
            price: {
              type: "number",
              description: "Price of the item"
            },
            wishId: {
              type: "string",
              description: "ID of the associated wish"
            }
          },
          required: ["name", "price", "wishId"]
        }
      },
      {
        name: "list_wishes",
        description:
          "Returns the list of wishes",
        inputSchema: {
          type: "object",
        },
        properties: {}
      },
      { 
        name: "elf_shopping_list",
        description: "Generate a shopping list for elves to build a specific wish",
        inputSchema: {
          type: "object",
          properties: {
            wish_id: {
              type: "string",
              description: "ID of the wish to analyze"
            }
          },
          required: ["wish_id"]
        }
      },
      {
        name: "mark_wish_as_granted",
        description: "Mark a wish as granted",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "ID of the wish"
            },
          },
          required: ["id"]
        }
      },
      {
        name: "delete_wish",
        description: "Delete a wish",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "ID of the wish"
            },
          },
          required: ["id"]
        }
      },
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    /**
     * Handler for the create_wish tool.
     * Creates a new wish with the provided text, and returns success message.
     */
    case "create_wish": {
      const text = String(request.params.arguments?.text);
      if (!text) {
        throw new Error("Text is required");
      }

      const response = await db.put({
        text: text,
        done: false,
        created: Date.now(),
      });

      return {
        content: [{
          type: "text",
          text: `Created wish ${response.id}: ${text}`
        }]
      };
    }

    /**
     * Handler for the create_elf_item tool.
     * Creates a new elf shopping item with name, price and associated wish.
     */
    case "create_elf_item": {
      const name = String(request.params.arguments?.name);
      const price = Number(request.params.arguments?.price);
      const wishId = String(request.params.arguments?.wishId);

      if (!name || !price || !wishId) {
        throw new Error("Name, price and wishId are required");
      }

      const response = await db.put({
        type: "elf",
        name,
        price,
        wishId,
        created: Date.now(),
      });

      return {
        content: [{
          type: "text",
          text: `Created elf item ${response.id}: ${name} ($${price})`
        }]
      };
    }

    /**
     * Handler for the list_wishes tool.
     * Returns the list of wishes
     */
    case "list_wishes": {
      return {
        content: [{
          type: "text",
          text: JSON.stringify(wishes)
        }]
      };
    }
    case "mark_wish_as_granted": {
      const id = String(request.params.arguments?.id);
      if (!id) {
        throw new Error("ID is required");
      }

      const doc = await db.get(id);
      const response = await db.put({
        ...doc,
        done: true
      });

      return {
        content: [{
          type: "text",
          text: `Marked wish ${response.id} as granted`
        }]
      };
    }
    case "delete_wish": {
      const id = String(request.params.arguments?.id);
      if (!id) {
        throw new Error("ID is required");
      }

      const response = await db.del(id);

      return {
        content: [{
          type: "text",
          text: `Deleted wish ${response.id}`
        }]
      };
    }

    default:
      throw new Error("Unknown tool");
  }
});

/**
 * Handler that lists available prompts.
 * Exposes a single "summarize_wishes" prompt that summarizes all wishes.
 */
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  console.log("Listing prompts...");
  return {
    prompts: [
      {
        name: "summarize_wishes",
        description: "Summarize all Christmas wishes",
      },
      {
        name: "elf_shopping_list",
        description: "Generate a shopping list for elves to build a specific wish",
        parameters: {
          type: "object",
          properties: {
            wish_id: {
              type: "string",
              description: "ID of the wish to analyze"
            }
          },
          required: ["wish_id"]
        }
      }
    ]
  };
});

/**
 * Handler for the summarize_wishes and elf_shopping_list prompts.
 * Returns prompts for either summarizing all wishes or generating a shopping list for a specific wish.
 */
server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  switch (request.params.name) {
    case "summarize_wishes": {
      const embeddedWishes = Object.entries(wishes).map(([id, wish]) => ({
        type: "resource" as const,
        resource: {
          uri: `wish:///${id}`,
          mimeType: "text/plain",
          text: 'text' in wish ? wish.text : `${wish.name} ($${wish.price})`
        }
      }));

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: "Please summarize the following Christmas wishes:"
            }
          },
          ...embeddedWishes.map(wish => ({
            role: "user" as const,
            content: wish
          })),
          {
            role: "user",
            content: {
              type: "text",
              text: "Provide a concise summary of all the Christmas wishes above."
            }
          }
        ]
      };
    }

    case "elf_shopping_list": {
      const wishId = String(request.params.arguments?.wish_id);
      const wish = wishes[wishId];

      if (!wish || !('text' in wish)) {
        throw new Error(`Wish ${wishId} not found`);
      }

      return {
        messages: [
          {
            role: "user",
            content: {
              type: "text",
              text: "Please analyze this Christmas wish and create a detailed shopping list for the elves:"
            }
          },
          {
            role: "user",
            content: {
              type: "resource",
              resource: {
                uri: `wish:///${wishId}`,
                mimeType: "text/plain",
                text: wish.text
              }
            }
          },
          {
            role: "user",
            content: {
              type: "text",
              text: "Create a shopping list with item names and estimated prices that the elves would need to build this wish. Format as a bullet point list with each item followed by its price in parentheses."
            }
          }
        ]
      };
    }

    default:
      throw new Error("Unknown prompt");
  }
});

/**
 * Start the server using stdio transport.
 * This allows the server to communicate via standard input/output streams.
 */
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error("Server error:", error);
  process.exit(1);
});

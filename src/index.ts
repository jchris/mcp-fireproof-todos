#!/usr/bin/env node

/**
 * This is a template MCP server that implements a simple todos system.
 * It demonstrates core MCP concepts like resources and tools by allowing:
 * - Listing todos as resources
 * - Reading individual todos
 * - Creating new todos via a tool
 * - Summarizing all todos via a prompt
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

/**
 * Type alias for a todo object.
 */
type Todo = {
  _id: string,
  done: boolean,
  text: string,
  created: Number,
  updated: Number
};

/**
 * Simple in-memory storage for todos.
 * In a real implementation, this would likely be backed by a database.
 */
const todos: { [id: string]: Todo } = {
  "1": {
    // '01939fb0-3bf1-75ad-b011-e418967fda72': {
    _id: '01939fb0-3bf1-75ad-b011-e418967fda72',
    done: true,
    text: 'Mushrooms',
    created: 1733550947313,
    updated: 1733550951733
  },
  "2": {
    // '01939d42-24cc-7ee7-b4d9-4ff48c12dd31': {
    _id: '01939d42-24cc-7ee7-b4d9-4ff48c12dd31',
    done: true,
    text: 'Beer',
    created: 1733510177996,
    updated: 1733550593765
  },
  "3": {
    // '01939d42-1a84-702b-badc-e42f48496aeb': {
    _id: '01939d42-1a84-702b-badc-e42f48496aeb',
    done: true,
    text: 'Eggs',
    created: 1733510175364,
    updated: 1733510183396
  }
};

/**
 * Create an MCP server with capabilities for resources (to list/read todos),
 * tools (to create new todos), and prompts (to summarize todos).
 */
const server = new Server(
  {
    name: "todos",
    version: "0.1.0",
  },
  {
    capabilities: {
      resources: {},
      tools: {},
      prompts: {},
    },
  }
);

/**
 * Handler for listing available todos as resources.
 * Each todo is exposed as a resource with:
 * - A todo:// URI scheme
 * - Plain text MIME type
 * - Human readable name and description (now including the todo title)
 */
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  return {
    resources: Object.entries(todos).map(([id, todo]) => ({
      uri: `todo:///${id}`,
      mimeType: "text/plain",
      name: todo.text,
      description: `A text todo: ${todo.text}`
    }))
  };
});

/**
 * Handler for reading the contents of a specific todo.
 * Takes a todo:// URI and returns the todo content as plain text.
 */
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const url = new URL(request.params.uri);
  const id = url.pathname.replace(/^\//, '');
  const todo = todos[id];

  if (!todo) {
    throw new Error(`Todo ${id} not found`);
  }

  return {
    contents: [{
      uri: request.params.uri,
      mimeType: "text/plain",
      text: todo.text
    }]
  };
});

/**
 * Handler that lists available tools.
 * Exposes a single "create_todo" tool that lets clients create new todos.
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "create_todo",
        description: "Create a new todo",
        inputSchema: {
          type: "object",
          properties: {
            text: {
              type: "string",
              description: "Content of the todo"
            },
            done: {
              type: "boolean",
              description: "Is the todo completed?"
            },
          },
          required: ["text", "done"]
        }
      },
      {
        name: "list_todos",
        description:
          "Returns the list of todos",
        inputSchema: {
          type: "object",
        },
        properties: {}
      },
    ]
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  switch (request.params.name) {
    /**
     * Handler for the create_todo tool.
     * Creates a new todo with the provided text, and returns success message.
     */
    case "create_todo": {
      const text = String(request.params.arguments?.text);
      if (!text) {
        throw new Error("Text is required");
      }

      const id = String(Object.keys(todos).length + 1);
      todos[id] = {
        _id: id,
        done: false,
        text: text,
        created: Date.now(),
        updated: Date.now()
      }

      return {
        content: [{
          type: "text",
          text: `Created todo ${id}: ${text}`
        }]
      };
    }
    /**
     * Handler for the list_todos tool.
     * Returns the list of todos
     */
    case "list_todos": {
      return {
        content: [{
          type: "text",
          text: JSON.stringify(todos)
        }]
      };
    }

    default:
      throw new Error("Unknown tool");
  }
});

/**
 * Handler that lists available prompts.
 * Exposes a single "summarize_todos" prompt that summarizes all todos.
 */
server.setRequestHandler(ListPromptsRequestSchema, async () => {
  return {
    prompts: [
      {
        name: "summarize_todos",
        description: "Summarize all todos",
      }
    ]
  };
});

/**
 * Handler for the summarize_todos prompt.
 * Returns a prompt that requests summarization of all todos, with the todos' contents embedded as resources.
 */
server.setRequestHandler(GetPromptRequestSchema, async (request) => {
  if (request.params.name !== "summarize_todos") {
    throw new Error("Unknown prompt");
  }

  const embeddedTodos = Object.entries(todos).map(([id, todo]) => ({
    type: "resource" as const,
    resource: {
      uri: `todo:///${id}`,
      mimeType: "text/plain",
      text: todo.text
    }
  }));

  return {
    messages: [
      {
        role: "user",
        content: {
          type: "text",
          text: "Please summarize the following todos:"
        }
      },
      ...embeddedTodos.map(todo => ({
        role: "user" as const,
        content: todo
      })),
      {
        role: "user",
        content: {
          type: "text",
          text: "Provide a concise summary of all the todos above."
        }
      }
    ]
  };
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

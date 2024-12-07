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
import { fireproof } from "use-fireproof";
// import { connect } from "@fireproof/cloud";

const db = fireproof("my_db");

/*
connect(db, "01939d41-7c80-7d19-bb83-375dc92fc92c").then((cx) => {
  // console.log("Connected", cx)
});
*/


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
const initialTodos = [
  'Mushrooms',
  'Bread',
  'Eggs',
  'Cheese'
];

const todos: { [id: string]: Todo } = {}

await db.ready()

setTimeout(async () => {
  /*
  for (const text of initialTodos) {
    await db.put({
      text: text,
      done: false,
      created: Date.now(),
    });
  }
    */
  const onDbEvent = async function () {
    const run = Math.random()
    console.error("Jim1", run)
    const fpTodos = await db.query("created", {
      includeDocs: true,
      descending: true,
      limit: 10,
    });
    for (let id in todos) {
      delete todos[id]
    }
    console.error("Jim2", run, fpTodos.rows.length)
    for (const row of fpTodos.rows) {
      let todo = row.doc;
      todos[todo!._id] = todo as Todo
    }
    console.error("Jim3", run, JSON.stringify(todos))
  };
  onDbEvent();
  db.subscribe(onDbEvent);
},
  1000
)


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

      /*
      const id = String(Object.keys(todos).length + 1);
      todos[id] = {
        _id: id,
        done: false,
        text: text,
        created: Date.now(),
        updated: Date.now()
      }
        */
      const response = await db.put({
        text: text,
        done: false,
        created: Date.now(),
      });

      return {
        content: [{
          type: "text",
          text: `Created todo ${response.id}: ${text}`
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

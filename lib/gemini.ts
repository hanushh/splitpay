import {
  GoogleGenerativeAI,
  SchemaType,
  type Content,
  type FunctionDeclaration,
  type Tool,
} from '@google/generative-ai';

const API_KEY = process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? '';

const genAI = new GoogleGenerativeAI(API_KEY);

// ── Tool declarations ────────────────────────────────────────────────────────

const appTools: FunctionDeclaration[] = [
  {
    name: 'add_expense',
    description:
      'Open the Add Expense screen, optionally pre-filling group, description, and amount.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        groupId: {
          type: SchemaType.STRING,
          description: 'ID of the group to add the expense to.',
        },
        groupName: {
          type: SchemaType.STRING,
          description: 'Display name of the group.',
        },
        description: {
          type: SchemaType.STRING,
          description: 'Short description of the expense (e.g. "Pizza").',
        },
        amountCents: {
          type: SchemaType.NUMBER,
          description: 'Expense amount in cents (e.g. 2000 = $20.00).',
        },
      },
      required: ['groupId', 'groupName'],
    },
  },
  {
    name: 'create_group',
    description: 'Open the Create Group screen.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {},
    },
  },
  {
    name: 'settle_up',
    description:
      'Open the Settle Up screen for a specific member balance in a group.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        groupId: {
          type: SchemaType.STRING,
          description: 'ID of the group.',
        },
        groupName: {
          type: SchemaType.STRING,
          description: 'Display name of the group.',
        },
        friendMemberId: {
          type: SchemaType.STRING,
          description: 'group_members.id of the friend to settle with.',
        },
        friendName: {
          type: SchemaType.STRING,
          description: 'Display name of the friend.',
        },
        amountCents: {
          type: SchemaType.NUMBER,
          description: 'Settlement amount in cents.',
        },
        payerMemberId: {
          type: SchemaType.STRING,
          description:
            'If the friend is paying the current user, provide their member ID here.',
        },
      },
      required: ['groupId', 'groupName', 'friendMemberId', 'friendName', 'amountCents'],
    },
  },
  {
    name: 'view_group',
    description: 'Navigate to a specific group detail screen.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        groupId: {
          type: SchemaType.STRING,
          description: 'ID of the group to open.',
        },
      },
      required: ['groupId'],
    },
  },
];

const tools: Tool[] = [{ functionDeclarations: appTools }];

// ── Types ────────────────────────────────────────────────────────────────────

export interface GeminiMessage {
  role: 'user' | 'model';
  parts: { text: string }[];
}

export interface FunctionCallResult {
  name: string;
  args: Record<string, unknown>;
}

export interface GeminiResponse {
  text: string | null;
  functionCall: FunctionCallResult | null;
}

// ── Main send function ───────────────────────────────────────────────────────

export async function sendChatMessage(
  history: GeminiMessage[],
  userMessage: string,
  systemContext: string,
): Promise<GeminiResponse> {
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: systemContext,
    tools,
  });

  const historyContent: Content[] = history.map((m) => ({
    role: m.role,
    parts: m.parts,
  }));

  const chat = model.startChat({ history: historyContent });

  const result = await chat.sendMessage(userMessage);
  const response = result.response;

  // Check for function call first
  const candidate = response.candidates?.[0];
  if (candidate?.content?.parts) {
    for (const part of candidate.content.parts) {
      if (part.functionCall) {
        return {
          text: null,
          functionCall: {
            name: part.functionCall.name,
            args: (part.functionCall.args ?? {}) as Record<string, unknown>,
          },
        };
      }
    }
  }

  return {
    text: response.text(),
    functionCall: null,
  };
}

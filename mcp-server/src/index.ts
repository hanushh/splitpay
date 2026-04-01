import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerGroupTools } from './tools/groups.js';
import { registerExpenseTools } from './tools/expenses.js';
import { registerBalanceTools } from './tools/balances.js';
import { registerActivityTools } from './tools/activity.js';
import { registerSettlementTools } from './tools/settlements.js';
import { registerSearchTools } from './tools/search.js';

const server = new McpServer({
  name: 'paysplit',
  version: '1.0.0',
});

registerGroupTools(server);
registerExpenseTools(server);
registerBalanceTools(server);
registerActivityTools(server);
registerSettlementTools(server);
registerSearchTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);

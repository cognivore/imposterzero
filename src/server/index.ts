#!/usr/bin/env node

import { LocalGameServer } from './server.js';

async function main(): Promise<void> {
  const port = parseInt(process.env.PORT || '3000');
  const server = new LocalGameServer(port);

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down server gracefully...');
    server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nShutting down server gracefully...');
    server.stop();
    process.exit(0);
  });

  try {
    await server.start();
    console.log('Server is ready for connections!');
    console.log('Press Ctrl+C to stop the server.');
  } catch (error) {
    console.error('Failed to start server:', error instanceof Error ? error.message : 'Unknown error');
    process.exit(1);
  }
}

// Only run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

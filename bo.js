#!/usr/bin/env node
import main from './src/index.js';

(async () => {
  await main();
  process.exit(0);
})()

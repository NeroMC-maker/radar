import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    adminUrl: string;
  }
}

export default async function setup(project: TestProject) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-test-pg-'));
  const port = 54400 + Math.floor(Math.random() * 500);
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: 'test',
    password: 'test',
    port,
    persistent: false,
    onLog: () => {},
    // Sin esto, en Windows el clúster hereda WIN1252 y rechaza emojis.
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });
  await pg.initialise();
  await pg.start();
  project.provide('adminUrl', `postgres://test:test@127.0.0.1:${port}/postgres`);
  return async () => {
    await pg.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  };
}

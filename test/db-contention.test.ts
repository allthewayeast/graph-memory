import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";
import { openDb, DEFAULT_DB_BUSY_TIMEOUT_MS } from "../src/store/db.ts";

let dir: string | undefined;
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("shared SQLite contention policy", () => {
  it("sets a configurable timeout and preserves FULL durability and automatic checkpoint", () => {
    dir = mkdtempSync(join(tmpdir(), "gm-db-settings-"));
    const db = openDb(join(dir, "memory.db"));
    try {
      expect(db.prepare("PRAGMA busy_timeout").get()).toMatchObject({ timeout: DEFAULT_DB_BUSY_TIMEOUT_MS });
      expect(db.prepare("PRAGMA synchronous").get()).toMatchObject({ synchronous: 2 });
      expect(db.prepare("PRAGMA wal_autocheckpoint").get()).toMatchObject({ wal_autocheckpoint: 1000 });
    } finally { db.close(); }
    const immediate = openDb(join(dir, "memory.db"), { busyTimeoutMs: 0 });
    try {
      expect(immediate.prepare("PRAGMA busy_timeout").get()).toMatchObject({ timeout: 0 });
    } finally { immediate.close(); }
    expect(() => openDb(":memory:", { busyTimeoutMs: -1 })).toThrow(/dbBusyTimeoutMs/);
  });

  it("waits for a real competing writer and commits without dropping a write", async () => {
    dir = mkdtempSync(join(tmpdir(), "gm-db-contention-"));
    const path = join(dir, "memory.db");
    const db = openDb(path, { busyTimeoutMs: 1500 });
    db.exec("CREATE TABLE contention (value TEXT)");
    const gate = new SharedArrayBuffer(4);
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(workerData.path);
      db.exec("BEGIN IMMEDIATE; INSERT INTO contention VALUES ('worker')");
      parentPort.postMessage('locked');
      Atomics.wait(new Int32Array(workerData.gate), 0, 0);
      Atomics.wait(new Int32Array(workerData.gate), 0, 1, 120);
      db.exec('COMMIT');
      db.close();
    `, { eval: true, workerData: { path, gate } });
    const exited = new Promise<void>((resolve, reject) => {
      worker.once("error", reject);
      worker.once("exit", code => code === 0 ? resolve() : reject(new Error(`worker exit ${code}`)));
    });
    try {
      await new Promise<void>((resolve, reject) => {
        worker.once("message", () => resolve());
        worker.once("error", reject);
      });
      Atomics.store(new Int32Array(gate), 0, 1);
      Atomics.notify(new Int32Array(gate), 0);
      // The lock holder runs on another thread, so it can release its lock
      // while the synchronous SQLite busy handler waits on this thread.
      db.prepare("INSERT INTO contention VALUES (?)").run("plugin");
      await exited;
      expect(db.prepare("SELECT value FROM contention ORDER BY rowid").all())
        .toEqual([{ value: "worker" }, { value: "plugin" }]);
    } finally {
      await worker.terminate();
      db.close();
    }
  });
});

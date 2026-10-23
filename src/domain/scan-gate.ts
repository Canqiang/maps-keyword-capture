import { MongoClient, ReadConcern, type Collection } from 'mongodb';

export interface Gate { _id: string; revision: number; roundId: string; shardCount: number; finished: number[]; active: boolean }
export interface GateRound { _id: string; group: string; shardCount: number; state: 'initializing' | 'admitted' | 'blocked' }
export interface GateRepository {
  claimRound(round: GateRound): Promise<boolean>;
  readRound(roundId: string): Promise<GateRound | null>;
  decideRound(roundId: string, state: 'admitted' | 'blocked'): Promise<void>;
  claimWorker(roundId: string, index: number): Promise<boolean>;
  read(group: string): Promise<Gate | null>;
  swap(previous: Gate | null, next: Gate): Promise<boolean>;
}
export async function enterScanGate(repo: GateRepository, group: string, roundId: string, shardCount: number, index: number): Promise<() => Promise<void>> {
  if (!group || !roundId || !Number.isInteger(shardCount) || shardCount < 1 || !Number.isInteger(index) || index < 0 || index >= shardCount) throw new Error('invalid scan gate identity');
  // Elect one target-admission decision for the whole Job. A rejected round stays rejected,
  // including workers that boot after the competing round has completed.
  if (await repo.claimRound({ _id: roundId, group, shardCount, state: 'initializing' })) {
    try {
      let admitted = false;
      for (let attempt = 0; attempt < 20; attempt++) {
        const previous = await repo.read(group);
        if (previous?.active) throw new Error('another scheduled/manual scan owns this target; no collection started');
        if (await repo.swap(previous, { _id: group, revision: (previous?.revision ?? 0) + 1, roundId, shardCount, finished: [], active: true })) { admitted = true; break; }
      }
      if (!admitted) throw new Error('scan gate contention; no collection started');
      await repo.decideRound(roundId, 'admitted');
    } catch (error) { await repo.decideRound(roundId, 'blocked').catch(() => undefined); throw error; }
  }
  const deadline = Date.now() + 120_000;
  for (;;) {
    const round = await repo.readRound(roundId);
    if (!round || round.group !== group || round.shardCount !== shardCount) throw new Error('scan gate round configuration mismatch');
    if (round.state === 'blocked') throw new Error('another scheduled/manual scan blocked this round; no collection started');
    if (round.state === 'admitted') break;
    if (Date.now() >= deadline) throw new Error('scan gate initialization timed out; operator review required');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  // Persistent index admission prevents duplicate/restarted workers from recapturing a round.
  if (!await repo.claimWorker(roundId, index)) throw new Error('scan round worker already admitted; investigate before retrying');
  const current = await repo.read(group);
  if (!current?.active || current.roundId !== roundId) throw new Error('scan gate ownership lost');
  return async () => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const previous = await repo.read(group);
      if (!previous || previous.roundId !== roundId || !previous.active) throw new Error('scan gate ownership lost');
      const finished = [...new Set([...previous.finished, index])].sort((a, b) => a - b);
      if (await repo.swap(previous, { ...previous, revision: previous.revision + 1, finished, active: finished.length !== shardCount })) return;
    }
    throw new Error('scan gate completion contention; operator review required');
  };
}

/** No time-based lock stealing: a delayed or orphaned worker must be checked by an operator. */
export class MongoGateRepository implements GateRepository {
  private readonly client: MongoClient;
  private readonly gates: Collection<Gate>;
  private readonly rounds: Collection<GateRound>;
  private readonly workers: Collection<{ _id: string }>;
  constructor(uri: string, database: string) {
    this.client = new MongoClient(uri, { serverSelectionTimeoutMS: 15_000 });
    const db = this.client.db(database, { writeConcern: { w: 'majority' }, readConcern: new ReadConcern('majority'), readPreference: 'primary' });
    this.rounds = db.collection('scan-gate-rounds-v1');
    this.gates = db.collection('scan-execution-gates-v1'); this.workers = db.collection('scan-worker-admissions-v1');
  }
  async claimRound(round: GateRound): Promise<boolean> {
    try { await this.rounds.insertOne(round); return true; }
    catch (error) { if ((error as { code?: number }).code === 11000) return false; throw error; }
  }
  readRound(roundId: string): Promise<GateRound | null> { return this.rounds.findOne({ _id: roundId }); }
  async decideRound(roundId: string, state: 'admitted' | 'blocked'): Promise<void> {
    const result = await this.rounds.updateOne({ _id: roundId, state: 'initializing' }, { $set: { state } });
    if (result.matchedCount !== 1) throw new Error('scan gate decision is already final');
  }
  async claimWorker(roundId: string, index: number): Promise<boolean> {
    try { await this.workers.insertOne({ _id: `${roundId}:${index}` }); return true; }
    catch (error) { if ((error as { code?: number }).code === 11000) return false; throw error; }
  }
  read(group: string): Promise<Gate | null> { return this.gates.findOne({ _id: group }); }
  async swap(previous: Gate | null, next: Gate): Promise<boolean> {
    if (previous) return (await this.gates.replaceOne({ _id: previous._id, revision: previous.revision }, next)).matchedCount === 1;
    try { await this.gates.insertOne(next); return true; }
    catch (error) { if ((error as { code?: number }).code === 11000) return false; throw error; }
  }
  close(): Promise<void> { return this.client.close(); }
}

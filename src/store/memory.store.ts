import { DataHandlerContext } from "@subsquid/batch-processor"
import { Store } from "@subsquid/typeorm-store"
import { Entity } from "@subsquid/typeorm-store/lib/store"

/**
 * Optimized store that keeps entities in RAM with separate insert and update lists
 * to improve database operations and reduce transaction conflicts.
 */
export class MemoryStore<T extends { id: string }> {
  // Lists for database operations - updateList also serves as our cache for existing entities
  private readonly insertList = new Map<string, T>()
  private readonly updateList = new Map<string, T>()
  private manager: StoreManager | null = null

  constructor(private readonly name: string) {}

  setManager(manager: StoreManager): void {
    this.manager = manager
  }

  /**
   * Find an entity by ID. This is the ONLY method that should read from the database
   * and populate the updateList (our cache for existing entities).
   */
  async find(id: string): Promise<T | undefined> {
    // 1. Check update list (entities that we know exist in DB)
    let entity = this.updateList.get(id);
    if (entity) {
      return entity;
    }

    // 2. Check insert list (new entities created in this batch)
    entity = this.insertList.get(id);
    if (entity) {
      return entity;
    }

    // 3. Not in memory, try database lookup
    if (this.manager) {
      try {
        const dbEntity = await this.manager.ctx.store.get(this.name as any, id);
        if (dbEntity) {
          // Add to update list (our cache) since it exists in DB
          const typedEntity = dbEntity as unknown as T
          this.updateList.set(id, typedEntity)
          return typedEntity
        }
      } catch (err) {
        console.error(`Error finding ${this.name} with ID ${id}:`, err)
      }
    }
    return undefined
  }

  /**
   * Saves an entity to the in-memory store without hitting the database.
   * This is now extremely fast as it avoids any DB lookups.
   */
  async save(entity: T): Promise<void> {
    // If it was already loaded from the DB, it will be in updateList. Update it there.
    if (this.updateList.has(entity.id)) {
      this.updateList.set(entity.id, entity)
      return
    }

    // Otherwise, it's a new entity created in this batch or an update to one.
    // We treat it as an "insert" or "upsert". The flush logic will handle it correctly.
    this.insertList.set(entity.id, entity);
  }

  getAll(): T[] {
    return [...this.updateList.values(), ...this.insertList.values()]
  }

  getCounts(): { total: number, inserts: number, updates: number } {
    return {
      total: this.updateList.size + this.insertList.size,
      inserts: this.insertList.size,
      updates: this.updateList.size
    }
  }

  /**
   * Flushes entities to the database. We use `upsert` for inserts as a robust
   * way to handle entities that might have been created in a previous batch but not cached.
   */
  async flush(): Promise<void> {
    if (!this.manager) {
      throw new Error('Cannot flush store without manager reference')
    }

    // `insertList` contains all entities created or modified in this batch that weren't
    // originally loaded from the DB. `upsert` is the safest and often most performant
    // way to handle them, as it performs an INSERT or UPDATE as needed.
    const upserts = Array.from(this.insertList.values())
    if (upserts.length > 0) {
      try {
        await this.manager.ctx.store.upsert(upserts)
      } catch (err) {
        console.error(`Error upserting ${this.name} entities:`, err)
        // Fallback to individual upserts
        for (const entity of upserts) {
          try {
            await this.manager.ctx.store.upsert(entity)
          } catch (innerErr) {
            console.error(`Error upserting ${this.name} entity ${entity.id}:`, innerErr)
          }
        }
      }
      this.insertList.clear()
    }

    // `updateList` contains entities that were explicitly loaded from the DB via `find()`.
    // We can confidently `save` (which means UPDATE) these.
    const updates = Array.from(this.updateList.values())
    if (updates.length > 0) {
      try {
        await this.manager.ctx.store.save(updates)
      } catch (err) {
        console.error(`Error saving updates for ${this.name} entities:`, err)
        for (const entity of updates) {
          try {
            await this.manager.ctx.store.save(entity)
          } catch (innerErr) {
            console.error(`Error saving update for ${this.name} entity ${entity.id}:`, innerErr)
          }
        }
      }
      this.updateList.clear()
    }
  }
}

/**
 * Manages MemoryStore instances and coordinates database operations.
 */
export class StoreManager {
  private readonly stores = new Map<string, MemoryStore<any>>()

  constructor(public readonly ctx: DataHandlerContext<any, Store>) {}

  getStore<E extends { id: string }>(name: string): MemoryStore<E> {
    let store = this.stores.get(name)
    if (!store) {
      store = new MemoryStore<E>(name)
      store.setManager(this)
      this.stores.set(name, store)
    }
    return store as MemoryStore<E>
  }

  /**
   * Flush all stores to the database in an order that respects foreign key constraints.
   */
  async save(): Promise<void> {
    // Define the explicit order for flushing
    const flushOrder = [
      'GlobalConfig',
      'PumpToken',
      'BondingCurve',
      'Trade',
      'TokenCreated',
      'TokenCompleted'
    ];

    for (const name of flushOrder) {
      const store = this.stores.get(name);
      if (store && store?.getCounts().total > 0) {
        await store.flush();
      }
    }
  }
}

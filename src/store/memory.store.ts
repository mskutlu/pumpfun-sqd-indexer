import { DataHandlerContext } from "@subsquid/batch-processor"
import { Store } from "@subsquid/typeorm-store"
import { BondingCurve, PumpToken } from "../model";
import { In } from "typeorm";

/**
 * Interface for prefetched entity collections
 */
export interface PrefetchedEntities {
  tokens: PumpToken[];
  curves: BondingCurve[];
}

/**
 * All entities created/updated within a block batch are kept in RAM and
 * flushed to Postgres once at the end of the batch.
 */
export class MemoryStore<T extends { id: string }> {
  private readonly map = new Map<string, T>()
  private manager: StoreManager | null = null

  constructor(private readonly name: string, initialEntities: T[] = []) {
    // Initialize the store with prefetched entities
    initialEntities.forEach(entity => {
      this.map.set(entity.id, entity);
    });
    
    //console.log(`Initialized ${name} store with ${initialEntities.length} prefetched entities`);
  }

  /**
   * Set the StoreManager reference to enable direct database flush
   */
  setManager(manager: StoreManager): void {
    this.manager = manager
  }

  /**
   * Flush entities in this store to the database
   */
  async flush(): Promise<void> {
    if (!this.manager) {
      throw new Error('Cannot flush store without manager reference')
    }
    
    // Direct database access - no more queue coordination needed
    const entities = this.getAll();
    if (entities.length > 0) {
      await this.manager.saveEntitiesToDatabase(entities);
      //console.log(`Flushed ${entities.length} entities from ${this.name} store`);
    }
  }

  async find(id: string): Promise<T | undefined> {
    // First check if entity exists in memory
    const memoryEntity = this.map.get(id)
    if (memoryEntity) {
      return memoryEntity
    }
    
    // If not found in memory, return undefined
    return undefined
  }

  async save(entity: T): Promise<void> {
    if (!this.manager) {
      throw new Error('Cannot save entity without manager reference')
    }
    
    // Store locally in memory - will be flushed when needed
    this.map.set(entity.id, entity)
    if (this.map.size > 1000) {
      const entities = Array.from(this.map.values())
      this.map.clear()
      // Use the StoreManager's transaction queue instead of direct database access
      await this.manager.saveEntitiesToDatabase(entities)
    }
  }

  // The saveForBatchLoading method is removed since we now prefetch entities at the start of processing

  getAll(): T[] {
    return Array.from(this.map.values())
  }
}

/**
 * Lazily instantiates `MemoryStore` instances keyed by entity name and exposes
 * the batch `ctx` for DB look-ups when a cache-miss occurs.
 */
export class StoreManager {
  private readonly stores = new Map<string, MemoryStore<any>>()

  /**
   * @param ctx The DataHandlerContext
   * @param prefetched Optional prefetched entities to initialize stores with
   */
  constructor(
    public readonly ctx: DataHandlerContext<any, Store>,
    prefetched?: PrefetchedEntities
  ) {
    // Initialize token and curve stores with prefetched data if provided
    if (prefetched) {
      if (prefetched.tokens.length > 0) {
        this.getStore<PumpToken>('PumpToken', prefetched.tokens);
      }
      
      if (prefetched.curves.length > 0) {
        this.getStore<BondingCurve>('BondingCurve', prefetched.curves);
      }
    }
  }

  getStore<E extends { id: string }>(name: string, initialEntities: E[] = []): MemoryStore<E> {
    let store = this.stores.get(name)
    if (!store) {
      store = new MemoryStore<E>(name, initialEntities)
      store.setManager(this)
      this.stores.set(name, store)
    }
    return store as MemoryStore<E>
  }

  getAllStores(): Map<string, MemoryStore<any>> {
    return this.stores
  }
  
  /**
   * Save entities directly to the database
   */
  async saveEntitiesToDatabase(entities: any[]): Promise<void> {
    if (entities.length > 0) {
      await this.ctx.store.upsert(entities);
    }
  }
  
  /**
   * Find entities by their IDs
   */
  async findEntitiesByIds<E extends { id: string }>(entityClass: any, ids: string[]): Promise<E[]> {
    return await this.ctx.store.findBy(entityClass, {
      id: In(ids)
    }) as E[]
  }
  
}

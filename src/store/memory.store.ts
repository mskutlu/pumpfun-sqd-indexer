import { DataHandlerContext } from "@subsquid/batch-processor"
import { Store } from "@subsquid/typeorm-store"

/**
 * All entities created/updated within a block batch are kept in RAM and
 * flushed to Postgres once at the end of the batch.
 */
export class MemoryStore<T extends { id: string }> {
  private readonly map = new Map<string, T>()
  private readonly events: T[] = []
  private manager: StoreManager | null = null

  constructor(private readonly name: string, readonly isEventType = false) {}

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
    
    const entities = this.getAll()
    if (entities.length > 0) {
      console.log(`Flushing ${entities.length} ${this.name} entities to database`)
      await this.manager.ctx.store.save(entities)
      
      // Clear memory after flush if it's an event type
      if (this.isEventType) {
        this.events.length = 0
      }
    }
  }

  async find(id: string): Promise<T | undefined> {
    // First check if entity exists in memory
    const memoryEntity = this.map.get(id)
    if (memoryEntity) {
      return memoryEntity
    }
    
    // If not found in memory, return undefined
    // Each service should handle database fallback by checking memory first using this method
    // Then falling back to a direct database query if needed, and calling save() on this store
    // to cache the result for future use
    return undefined
  }

  async save(entity: T): Promise<void> {
    if (this.isEventType) {
      // For event types, make sure we don't add duplicates with the same ID
      // Check if we already have an event with this ID
      const existingIndex = this.events.findIndex(e => e.id === entity.id);
      if (existingIndex >= 0) {
        // Replace the existing event
        this.events[existingIndex] = entity;
      } else {
        // Add new event
        this.events.push(entity);
      }
    } else {
      this.map.set(entity.id, entity)
    }
  }

  async update(entity: T): Promise<void> {
    if (this.isEventType) throw new Error("Cannot update append-only event entities")
    this.map.set(entity.id, entity)
  }

  getAll(): T[] {
    return this.isEventType ? this.events : Array.from(this.map.values())
  }
}

/**
 * Lazily instantiates `MemoryStore` instances keyed by entity name and exposes
 * the batch `ctx` for DB look-ups when a cache-miss occurs.
 */
export class StoreManager {
  private readonly stores = new Map<string, MemoryStore<any>>()

  constructor(public readonly ctx: DataHandlerContext<any, Store>) {}

  getStore<E extends { id: string }>(name: string, isEventType = false): MemoryStore<E> {
    let store = this.stores.get(name)
    if (!store) {
      store = new MemoryStore<E>(name, isEventType)
      // Set the manager reference so the store can flush directly
      store.setManager(this)
      this.stores.set(name, store)
    }
    return store as MemoryStore<E>
  }

  getAllStores(): Map<string, MemoryStore<any>> {
    return this.stores
  }
  
  /**
   * Save all entities in memory stores to the database with optimized batching
   */
  async save(): Promise<void> {
    const OPTIMAL_BATCH_SIZE = 2000; // Larger batch size for better performance
    
    // First collect all entities by type to minimize database round-trips
    const nonEventEntities: Record<string, any[]> = {};
    const eventEntities: Record<string, any[]> = {};
    
    // Organize entities by type
    for (const [name, store] of this.stores.entries()) {
      const entities = store.getAll();
      if (entities.length === 0) continue;
      
      if (store.isEventType) {
        eventEntities[name] = entities;
      } else {
        nonEventEntities[name] = entities;
      }
    }
    
    // Process non-event entities first (these are typically referenced by events)
    for (const [name, entities] of Object.entries(nonEventEntities)) {
      console.log(`Saving ${entities.length} ${name} entities`);
      
      // Process in optimized batches
      for (let i = 0; i < entities.length; i += OPTIMAL_BATCH_SIZE) {
        const batch = entities.slice(i, i + OPTIMAL_BATCH_SIZE);
        await this.ctx.store.save(batch);
      }
    }
    
    // Then process event entities that may reference the non-event entities
    for (const [name, entities] of Object.entries(eventEntities)) {
      console.log(`Saving ${entities.length} ${name} entities`);
      
      // Process in optimized batches
      for (let i = 0; i < entities.length; i += OPTIMAL_BATCH_SIZE) {
        const batch = entities.slice(i, i + OPTIMAL_BATCH_SIZE);
        await this.ctx.store.save(batch);
      }
    }
  }
}

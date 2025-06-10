import { DataHandlerContext } from "@subsquid/batch-processor"
import { Store } from "@subsquid/typeorm-store"

/**
 * All entities created/updated within a block batch are kept in RAM and
 * flushed to Postgres once at the end of the batch.
 */
export class MemoryStore<T extends { id: string }> {
  private readonly map = new Map<string, T>()
  private manager: StoreManager | null = null

  constructor(private readonly name: string) {}

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
      await this.manager.ctx.store.upsert(entities)

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
    this.map.set(entity.id, entity)

    if (this.map.size > 1000) {
      const entities = Array.from(this.map.values())
      this.map.clear()
      // console.log(`batch save ${this.name} entities`)
      this.manager?.ctx.store.upsert(entities).catch((err) => {
        console.error(`Failed to batch save ${this.name} entities`, err)
      })
    }
  }


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

  constructor(public readonly ctx: DataHandlerContext<any, Store>) {}

  getStore<E extends { id: string }>(name: string): MemoryStore<E> {
    let store = this.stores.get(name)
    if (!store) {
      store = new MemoryStore<E>(name)
      // Set the manager reference so the store can flush directly
      store.setManager(this)
      this.stores.set(name, store)
    }
    return store as MemoryStore<E>
  }

  getAllStores(): Map<string, MemoryStore<any>> {
    return this.stores
  }

}

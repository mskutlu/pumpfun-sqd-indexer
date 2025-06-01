import { DataHandlerContext } from "@subsquid/batch-processor"
import { Store } from "@subsquid/typeorm-store"
import { Entity } from "@subsquid/typeorm-store/lib/store"

/**
 * Optimized store that keeps entities in RAM with separate insert and update lists
 * to improve database operations and reduce transaction conflicts.
 */
export class MemoryStore<T extends { id: string }> {
  // Lists for database operations - updateList also serves as our cache
  private readonly insertList = new Map<string, T>()
  private readonly updateList = new Map<string, T>()
  private manager: StoreManager | null = null

  constructor(private readonly name: string) {}

  /**
   * Set the StoreManager reference to enable direct database operations
   */
  setManager(manager: StoreManager): void {
    this.manager = manager
  }

  /**
   * Find an entity by ID, first checking in memory and then in database if needed
   * This is the central find method that all services should use
   * @param id Entity ID to find
   * @returns The entity or undefined if not found
   */
  async find(id: string): Promise<T | undefined> {
    // First check in memory (updateList is our cache)
    const cachedEntity = this.updateList.get(id)
    if (cachedEntity) {
      return cachedEntity
    }
    
    // Also check insert list for new entities not yet persisted
    const newEntity = this.insertList.get(id)
    if (newEntity) {
      return newEntity
    }

    // Not in memory, try database lookup
    if (this.manager) {
      try {
        const entity = await this.manager.ctx.store.get(this.name as any, id)
        if (entity) {
          // Add to update list (since it exists in DB)
          const typedEntity = entity as unknown as T
          this.updateList.set(id, typedEntity)
          return typedEntity
        }
      } catch (err) {
        console.error(`Error finding ${this.name} with ID ${id}:`, err)
      }
    }

    // Not found anywhere
    return undefined
  }

  /**
   * Save an entity - automatically determines if it's an insert or update
   * @param entity Entity to save
   */
  async save(entity: T): Promise<void> {
    // Check if this entity already exists in our update list (DB entities)
    if (this.updateList.has(entity.id)) {
      // It's an update of an existing entity
      this.updateList.set(entity.id, entity)
      return
    }
    
    // If it's in our insert list, update it there
    if (this.insertList.has(entity.id)) {
      this.insertList.set(entity.id, entity)
      return
    }
    
    // Not in our memory lists, check DB if we can
    if (this.manager) {
      try {
        const existsInDb = await this.manager.ctx.store.get(this.name as any, entity.id)
        if (existsInDb) {
          // It exists in DB, so it's an update
          this.updateList.set(entity.id, entity)
        } else {
          // Not in DB, so it's an insert
          this.insertList.set(entity.id, entity)
        }
      } catch (err) {
        // Assume it's new if we can't verify
        this.insertList.set(entity.id, entity)
      }
    } else {
      // Can't check DB, assume it's new
      this.insertList.set(entity.id, entity)
    }
  }

  /**
   * Get all entities currently in memory
   */
  getAll(): T[] {
    // Combine entities from both lists
    const allEntities = [...Array.from(this.updateList.values()), ...Array.from(this.insertList.values())]
    return allEntities
  }

  /**
   * Get counts of pending operations
   */
  getCounts(): { total: number, inserts: number, updates: number } {
    return {
      total: this.updateList.size + this.insertList.size,
      inserts: this.insertList.size,
      updates: this.updateList.size
    }
  }

  /**
   * Flush entities in this store to the database
   * This separates inserts and updates to avoid transaction conflicts
   */
  async flush(): Promise<void> {
    if (!this.manager) {
      throw new Error('Cannot flush store without manager reference')
    }

    // Process all inserts at once
    const inserts = Array.from(this.insertList.values())
    if (inserts.length > 0) {
      console.log(`Inserting ${inserts.length} ${this.name} entities`)
      try {
        await this.manager.ctx.store.insert(inserts)
      } catch (err) {
        console.error(`Error inserting ${this.name} entities:`, err)
        // Fall back to individual inserts if batch fails
        for (const entity of inserts) {
          try {
            await this.manager.ctx.store.insert(entity)
          } catch (innerErr) {
            console.error(`Error inserting ${this.name} entity ${entity.id}:`, innerErr)
          }
        }
      }
      
      // Clear the insert list after processing
      this.insertList.clear()
    }

    // Process all updates at once
    const updates = Array.from(this.updateList.values())
    if (updates.length > 0) {
      console.log(`Updating ${updates.length} ${this.name} entities`)
      try {
        await this.manager.ctx.store.save(updates)
      } catch (err) {
        console.error(`Error updating ${this.name} entities:`, err)
        // Fall back to individual updates if batch fails
        for (const entity of updates) {
          try {
            await this.manager.ctx.store.save(entity)
          } catch (innerErr) {
            console.error(`Error updating ${this.name} entity ${entity.id}:`, innerErr)
          }
        }
      }
      
      // Clear the update list after processing
      this.updateList.clear()
    }
  }
}

/**
 * Manages MemoryStore instances and coordinates database operations
 */
export class StoreManager {
  private readonly stores = new Map<string, MemoryStore<any>>()

  constructor(public readonly ctx: DataHandlerContext<any, Store>) {}

  /**
   * Get or create a memory store for the specified entity type
   */
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
   * Get all stores managed by this manager
   */
  getAllStores(): Map<string, MemoryStore<any>> {
    return this.stores
  }

  /**
   * Flush all stores to the database in an optimized order
   */
  async save(): Promise<void> {
    for (const [name, store] of this.stores.entries()) {
      const counts = store.getCounts()
      if (counts.total > 0) {
        console.log(`Flushing ${name} store: ${counts.inserts} inserts, ${counts.updates} updates`)
        await store.flush()
      }
    }
  }
}

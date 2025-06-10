import { DataHandlerContext } from "@subsquid/batch-processor"
import { Store } from "@subsquid/typeorm-store"
import {BondingCurve} from "../model";
import {In} from "typeorm";

type TransactionOperation = {
  type: 'save' | 'batchSave' | 'flush'
  storeName: string
  entities?: any[]
  entity?: any
  resolve: (value: any) => void
  reject: (error: any) => void
}

/**
 * All entities created/updated within a block batch are kept in RAM and
 * flushed to Postgres once at the end of the batch.
 */
export class MemoryStore<T extends { id: string }> {
  private readonly map = new Map<string, T>()
  private readonly batchList = new Map<string, T>()
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
    
    // Use the StoreManager's transaction queue for coordinated database access
    await this.manager.scheduleFlush(this.name)
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
    
    // Store locally first
    this.map.set(entity.id, entity)

    if (this.map.size > 1000) {
      const entities = Array.from(this.map.values())
      this.map.clear()
      // Use the StoreManager's transaction queue instead of direct database access
      await this.manager.scheduleBatchSave(this.name, entities)
    }
  }

  async saveForBatchLoading(entity: T): Promise<void> {
    if (!this.manager) {
      throw new Error('Cannot save entity for batch loading without manager reference')
    }
    
    this.batchList.set(entity.id, entity)
    if (this.batchList.size >= 500) {
      const entities = Array.from(this.batchList.values())
      const entityIds = entities.map(entity => entity.id);

      try {
        // Use manager's method to safely query the database
        const existingEntities = await this.manager.findEntitiesByIds<BondingCurve>(BondingCurve, entityIds);
        
        // Create a set of existing IDs for fast lookup
        const existingIds = new Set(existingEntities?.map((e: BondingCurve) => e.id) || []);

        // Filter entities that don't exist in the database
        entities.filter(entity => !existingIds.has(entity.id))
            .forEach(entity =>
            this.map.set(entity.id, entity));

        existingEntities?.forEach((entity: BondingCurve) => {
          const updatedEntity = entities.find(e => e.id === entity.id);

          if (updatedEntity) {
            entity.virtualSolReserves = (updatedEntity as any).virtualSolReserves;
            entity.virtualTokenReserves = (updatedEntity as any).virtualTokenReserves;
            entity.realSolReserves = entity.realSolReserves + (updatedEntity as any).realSolReserves;
            entity.realTokenReserves = entity.realTokenReserves + (updatedEntity as any).realTokenReserves;
            this.map.set(entity.id, updatedEntity);
          }
        })
      } catch (err) {
        console.error(`Failed to process batch loading for ${this.name}:`, err)
      } finally {
        this.batchList.clear();
      }
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
  private transactionQueue: TransactionOperation[] = []
  private isProcessingQueue = false
  private transactionLock = false

  constructor(public readonly ctx: DataHandlerContext<any, Store>) {}

  getStore<E extends { id: string }>(name: string): MemoryStore<E> {
    let store = this.stores.get(name)
    if (!store) {
      store = new MemoryStore<E>(name)
      // Set the manager reference so the store can use coordinated operations
      store.setManager(this)
      this.stores.set(name, store)
    }
    return store as MemoryStore<E>
  }

  getAllStores(): Map<string, MemoryStore<any>> {
    return this.stores
  }
  
  /**
   * Schedule a flush operation in the transaction queue
   */
  async scheduleFlush(storeName: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.transactionQueue.push({
        type: 'flush',
        storeName,
        resolve,
        reject
      })
      this.processQueue()
    })
  }
  
  /**
   * Schedule a batch save operation in the transaction queue
   */
  async scheduleBatchSave(storeName: string, entities: any[]): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.transactionQueue.push({
        type: 'batchSave',
        storeName,
        entities,
        resolve,
        reject
      })
      this.processQueue()
    })
  }
  
  /**
   * Safely find entities by their IDs with transaction coordination
   */
  async findEntitiesByIds<E extends { id: string }>(entityClass: any, ids: string[]): Promise<E[]> {
    // Wait for any ongoing transaction to complete
    await this.acquireLock()
    try {
      return await this.ctx.store.findBy(entityClass, {
        id: In(ids)
      }) as E[]
    } finally {
      this.releaseLock()
    }
  }
  
  /**
   * Process the transaction queue sequentially
   */
  private async processQueue(): Promise<void> {
    if (this.isProcessingQueue || this.transactionQueue.length === 0) {
      return
    }
    
    this.isProcessingQueue = true
    
    while (this.transactionQueue.length > 0) {
      const operation = this.transactionQueue.shift()!
      
      try {
        await this.acquireLock()
        
        switch (operation.type) {
          case 'flush':
            try {
              const store = this.stores.get(operation.storeName)
              if (store) {
                const entities = store.getAll()
                if (entities.length > 0) {
                  await this.ctx.store.upsert(entities)
                }
              }
              operation.resolve(undefined)
            } catch (error) {
              console.error(`Failed to flush ${operation.storeName}:`, error)
              operation.reject(error)
            }
            break
            
          case 'batchSave':
            try {
              if (operation.entities && operation.entities.length > 0) {
                await this.ctx.store.upsert(operation.entities)
              }
              operation.resolve(undefined)
            } catch (error) {
              console.error(`Failed to batch save ${operation.storeName}:`, error)
              operation.reject(error)
            }
            break
            
          default:
            console.warn(`Unknown operation type: ${(operation as any).type}`)
            operation.resolve(undefined)
        }
      } finally {
        this.releaseLock()
      }
    }
    
    this.isProcessingQueue = false
  }
  
  /**
   * Acquire the transaction lock
   */
  private async acquireLock(): Promise<void> {
    return new Promise<void>((resolve) => {
      const check = () => {
        if (!this.transactionLock) {
          this.transactionLock = true
          resolve()
        } else {
          setTimeout(check, 10) // Check again after a short delay
        }
      }
      check()
    })
  }
  
  /**
   * Release the transaction lock
   */
  private releaseLock(): void {
    this.transactionLock = false
  }
}

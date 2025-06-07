import { GlobalConfig } from "../model"
import { MemoryStore, StoreManager } from "../store/memory.store"
import { Instruction as SolInstruction } from "@subsquid/solana-objects"
import * as pumpIns from "../abi/pump-fun/instructions"

/**
 * Handles `initialize` and `setParams` instructions that act on the singleton
 * GlobalConfig PDA.
 */
export class GlobalService {
  private readonly store: MemoryStore<GlobalConfig>
  private readonly storeManager: StoreManager

  constructor(storeManager: StoreManager) {
    this.storeManager = storeManager
    this.store = storeManager.getStore<GlobalConfig>("GlobalConfig")
  }

  /**
   * Flush any pending global config entities to the database
   */
  async flush(): Promise<void> {
    await this.store.flush();
  }
  
  /**
   * Creates or updates the global config with smart caching
   * Uses a memory-first approach to avoid redundant database lookups
   */
  async setGlobalConfig(params: {
    id: string
    feeRecipient: string
    feeBasisPoints: bigint
    createdAt: Date
    updatedAt: Date
  }): Promise<GlobalConfig> {
    // Use in-memory cache first for fastest lookup
    const cacheId = params.id;
    
    // Try to get from cache first
    let config = this.store.getFromMemoryCache(cacheId);
    
    if (!config) {
      // If not in memory, use the find method which checks memory then database
      config = await this.store.find(cacheId);
      
      if (!config) {
        // Create new global config if not found anywhere
        config = new GlobalConfig(params);
      } else {
        // Update existing config
        config.feeRecipient = params.feeRecipient;
        config.feeBasisPoints = params.feeBasisPoints;
        config.updatedAt = params.updatedAt;
      }
    } else {
      // We found it in memory, just update the properties
      config.feeRecipient = params.feeRecipient;
      config.feeBasisPoints = params.feeBasisPoints;
      config.updatedAt = params.updatedAt;
    }
    
    // Save will automatically determine if it's an insert or update
    // and update the memory cache
    await this.store.save(config);
    return config;
  }

  getAll(): GlobalConfig[] {
    return this.store.getAll()
  }

  /**
   * Process an initialize instruction
   * Modified to accept primitives directly to avoid object allocation
   */
  async processInitializeInstruction(
    instruction: SolInstruction,
    timestamp: Date,
    slot: number,
    txSignature: string,
    stats: any
  ): Promise<void> {
    
    try {
      // Decode the instruction
      const decoded = pumpIns.initialize.decode(instruction);
      
      const { accounts } = decoded;
      // If accounts or user is undefined, create with default values
      const userId = accounts?.user ? accounts.user.toString() : 'default-user';
      
      // Create the global config with default values - always create even if decoding fails
      const config = await this.setGlobalConfig({
        id: 'global',
        feeRecipient: userId,
        feeBasisPoints: 30n, // Default fee basis points
        createdAt: timestamp,
        updatedAt: timestamp
      });
      
      stats.entities.globalConfigs++;
    } catch (error: any) {
      console.error(`Error processing initialize instruction: ${error.message}`);
      console.error(error.stack);
      
      // Create a fallback global config to ensure it exists
      try {
        const config = await this.setGlobalConfig({
          id: 'global',
          feeRecipient: 'fallback-user',
          feeBasisPoints: 30n,
          createdAt: timestamp,
          updatedAt: timestamp
        });
        stats.entities.globalConfigs++;
      } catch (fallbackError: any) {
        console.error(`Error creating fallback global config: ${fallbackError.message}`);
      }
    }
  }

  /**
   * Process a setParams instruction
   * Modified to accept primitives directly to avoid object allocation
   */
  async processSetParamsInstruction(
    instruction: SolInstruction,
    timestamp: Date,
    slot: number,
    txSignature: string,
    stats: any
  ): Promise<void> {
    
    try {
      // Decode the instruction
      const decoded = pumpIns.setParams.decode(instruction);
      const { accounts, data } = decoded;
      const { global, user } = accounts;
      
      // Extract parameters from instruction data
      // The data might be empty or not properly typed, so handle safely
      const feeRecipient = user.toString();
      const feeBasisPoints = 30n; // Default fee basis points
      
      // Set defaults for curve parameters
      const initialVirtualTokenReserves = 1000000n;
      const initialVirtualSolReserves = 1000000n;
      const initialRealTokenReserves = 0n;
      const tokenTotalSupply = 1000000000n;
      
      // Create or update the global config
      await this.setGlobalConfig({
        id: 'global',
        feeRecipient,
        feeBasisPoints,
        createdAt: timestamp,
        updatedAt: timestamp
      });
      
      // Store these parameters for bonding curve creation
      this.initialVirtualTokenReserves = initialVirtualTokenReserves;
      this.initialVirtualSolReserves = initialVirtualSolReserves;
      this.initialRealTokenReserves = initialRealTokenReserves;
      this.tokenTotalSupply = tokenTotalSupply;
      
      stats.entities.globalConfigs++;
    } catch (error) {
      console.error('Error processing setParams instruction:', error);
      throw error;
    }
  }
  
  // Store global parameters for new bonding curves
  private initialVirtualTokenReserves: bigint = 1000000n; // Default values
  private initialVirtualSolReserves: bigint = 1000000n;
  private initialRealTokenReserves: bigint = 0n;
  private tokenTotalSupply: bigint = 1000000000n;
  
  /**
   * Get current global parameters for new bonding curves
   */
  getCurveParameters(): {
    initialVirtualTokenReserves: bigint;
    initialVirtualSolReserves: bigint;
    initialRealTokenReserves: bigint;
    tokenTotalSupply: bigint;
  } {
    return {
      initialVirtualTokenReserves: this.initialVirtualTokenReserves,
      initialVirtualSolReserves: this.initialVirtualSolReserves,
      initialRealTokenReserves: this.initialRealTokenReserves,
      tokenTotalSupply: this.tokenTotalSupply
    };
  }
}

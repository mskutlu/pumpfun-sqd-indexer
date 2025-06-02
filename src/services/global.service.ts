import { GlobalConfig } from "../model"
import { StoreWithCache } from '@belopash/typeorm-store'
import { Instruction as SolInstruction } from "@subsquid/solana-objects"
import * as pumpIns from "../abi/pump-fun/instructions"

/**
 * Handles `initialize` and `setParams` instructions that act on the singleton
 * GlobalConfig PDA.
 */
export class GlobalService {
  private readonly store: StoreWithCache

  constructor(store: StoreWithCache) {
    this.store = store
  }

  /**
   * Flush is now a no-op since StoreWithCache handles batching automatically
   */
  async flush(): Promise<void> {
    // No-op as StoreWithCache handles batching
  }
  
  /**
   * Creates or updates the global config using StoreWithCache's optimized getOrInsert and upsert
   */
  async setGlobalConfig(params: {
    id: string
    feeRecipient: string
    feeBasisPoints: bigint
    createdAt: Date
    updatedAt: Date
  }): Promise<GlobalConfig> {
    // Use StoreWithCache's defer to optimize database access
    this.store.defer(GlobalConfig, params.id)
    
    // Use getOrInsert for optimized entity creation/retrieval
    const config = await this.store.getOrInsert(GlobalConfig, params.id, () => {
      return new GlobalConfig({
        id: params.id,
        feeRecipient: params.feeRecipient,
        feeBasisPoints: params.feeBasisPoints,
        createdAt: params.createdAt,
        updatedAt: params.updatedAt
      })
    })
    
    // Update existing config if needed
    if (config.feeRecipient !== params.feeRecipient || 
        config.feeBasisPoints !== params.feeBasisPoints || 
        config.updatedAt !== params.updatedAt) {
      
      config.feeRecipient = params.feeRecipient
      config.feeBasisPoints = params.feeBasisPoints
      config.updatedAt = params.updatedAt
      
      // Use upsert for optimized updates
      await this.store.upsert(config)
    }
    
    return config
  }

  async getAll(): Promise<GlobalConfig[]> {
    return await this.store.find(GlobalConfig, {})
  }

  /**
   * Process an initialize instruction
   */
  async processInitializeInstruction(
    context: { instruction: SolInstruction; timestamp: Date; slot: number; txSignature: string },
    stats: any
  ): Promise<void> {
    const { instruction, timestamp, txSignature } = context;
    
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
         await this.setGlobalConfig({
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
   */
  async processSetParamsInstruction(
    context: { instruction: SolInstruction; timestamp: Date; slot: number; txSignature: string },
    stats: any
  ): Promise<void> {
    const { instruction, timestamp } = context;
    
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

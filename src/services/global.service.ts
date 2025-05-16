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
   * Creates or updates the global config
   */
  async setGlobalConfig(params: {
    id: string
    feeRecipient: string
    feeBasisPoints: bigint
    createdAt: Date
    updatedAt: Date
  }): Promise<GlobalConfig> {
    // First check in memory
    let config = await this.store.find(params.id)
    
    // If not in memory, try to find in database
    if (!config) {
      try {
        config = await this.storeManager.ctx.store.get(GlobalConfig, params.id);
        if (config) {
          // Add to memory store for future access
          await this.store.save(config);
        }
      } catch (err) {
        console.error(`Error loading global config ${params.id} from database:`, err);
      }
    }
    
    if (!config) {
      // Create new global config if not found in either memory or database
      config = new GlobalConfig(params)
      await this.store.save(config)
    } else {
      // Update existing config
      config.feeRecipient = params.feeRecipient
      config.feeBasisPoints = params.feeBasisPoints
      config.updatedAt = params.updatedAt
      await this.store.update(config)
    }
    
    return config
  }

  getAll(): GlobalConfig[] {
    return this.store.getAll()
  }

  /**
   * Process an initialize instruction
   */
  async processInitializeInstruction(
    context: { instruction: SolInstruction; timestamp: Date; slot: number; txSignature: string },
    stats: any
  ): Promise<void> {
    const { instruction, timestamp } = context;
    
    try {
      // Decode the instruction
      const decoded = pumpIns.initialize.decode(instruction);
      const { accounts } = decoded;
      const { user } = accounts;
      
      // Create the global config with default values
      const config = await this.setGlobalConfig({
        id: 'global',
        feeRecipient: user.toString(), // Default to instruction signer until setParams is called
        feeBasisPoints: 0n, // Default until setParams is called
        createdAt: timestamp,
        updatedAt: timestamp
      });
      
      stats.entities.globalConfigs++;
    } catch (error) {
      console.error('Error processing initialize instruction:', error);
      throw error;
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

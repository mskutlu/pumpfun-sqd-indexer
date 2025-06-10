import { BondingCurve } from "../model"
import { MemoryStore, StoreManager } from "../store/memory.store"
import { Instruction as SolInstruction } from "@subsquid/solana-objects"
import * as pumpIns from "../abi/pump-fun/instructions"
import { TokenService } from "./token.service"

/**
 * Stores and updates BondingCurve entities.  All reserve deltas are applied
 * in-memory and the final state is persisted at the end of the batch.
 */
export class BondingCurveService {
  private readonly store: MemoryStore<BondingCurve>
  private readonly storeManager: StoreManager

  constructor(
    storeManager: StoreManager,
    private readonly tokenService?: TokenService
  ) {
    this.storeManager = storeManager
    this.store = storeManager.getStore<BondingCurve>("BondingCurve")
  }

  /**
   * Flush any pending bonding curve entities to the database
   */
  async flush(): Promise<void> {
    await this.store.flush();
  }
  
  /**
   * Creates a new bonding curve entity
   */
  async createBondingCurve(params: {
    id: string
    token: any
    virtualSolReserves: bigint
    virtualTokenReserves: bigint
    realSolReserves: bigint
    realTokenReserves: bigint
    tokenTotalSupply: bigint
    feeBasisPoints: bigint
    createdAt: Date
    updatedAt: Date
  }): Promise<BondingCurve> {
    let curve = await this.store.find(params.id)
    if (curve) return curve // Already exists
    
    curve = new BondingCurve(params)
    await this.store.save(curve)
    return curve
  }
  
  /**
   * Gets a bonding curve by ID
   */
  async getBondingCurve(id: string): Promise<BondingCurve | undefined> {
    // First check in memory
    let curve = await this.store.find(id);
    
    // If not in memory, try to find in database
    if (!curve) {
      try {
        curve = await this.storeManager.ctx.store.get(BondingCurve, id);
        if (curve) {
          // Add to memory store for future access
          await this.store.save(curve);
        }
      } catch (err) {
        console.error(`Error loading bonding curve ${id} from database:`, err);
      }
    }
    
    return curve;
  }
  
  /**
   * Gets bonding curve by token ID
   */
  async getBondingCurveByToken(tokenId: string): Promise<BondingCurve | undefined> {
    // Find the bonding curve associated with a specific token
    const curves = this.store.getAll()
    return curves.find(curve => curve.token && curve.token.id === tokenId)
  }
  
  /**
   * Updates an existing bonding curve's data
   */
  async updateBondingCurve(curveId: string, params: {
    virtualSolReserves?: bigint
    virtualTokenReserves?: bigint
    realSolReserves?: bigint
    realTokenReserves?: bigint
    tokenTotalSupply?: bigint
    feeBasisPoints?: bigint
    updatedAt: Date
  }): Promise<BondingCurve | undefined> {
    const curve = await this.store.find(curveId)
    if (!curve) return undefined
    
    if (params.virtualSolReserves !== undefined) curve.virtualSolReserves = params.virtualSolReserves
    if (params.virtualTokenReserves !== undefined) curve.virtualTokenReserves = params.virtualTokenReserves
    if (params.realSolReserves !== undefined) curve.realSolReserves = params.realSolReserves
    if (params.realTokenReserves !== undefined) curve.realTokenReserves = params.realTokenReserves
    if (params.tokenTotalSupply !== undefined) curve.tokenTotalSupply = params.tokenTotalSupply
    if (params.feeBasisPoints !== undefined) curve.feeBasisPoints = params.feeBasisPoints
    curve.updatedAt = params.updatedAt
    
    await this.store.save(curve)
    return curve
  }

  getAllCurves() {
    return this.store.getAll()
  }
  
  /**
   * Process a withdraw instruction directly from instruction data
   */
  async processWithdrawInstruction(
    context: { instruction: SolInstruction; timestamp: Date; slot: number; txSignature: string },
    stats: any
  ): Promise<void> {
    const { instruction, timestamp, slot, txSignature } = context;
    
    try {
      // Decode the instruction
      const decoded = pumpIns.withdraw.decode(instruction);
      
      const { accounts } = decoded;
      // Handle potentially undefined accounts safely
      const bondingCurveId = accounts?.bondingCurve ? accounts.bondingCurve.toString() : `placeholder-${txSignature}`;
      const userId = accounts?.user ? accounts.user.toString() : 'unknown-user';
      
      // Get the bonding curve
      let curve = await this.getBondingCurve(bondingCurveId);
    
      // If curve not found, create a placeholder
      if (!curve) {
        curve = new BondingCurve({
          id: bondingCurveId,
          token: null as any, // Placeholder for token relationship
          virtualSolReserves: 0n,
          virtualTokenReserves: 0n,
          realSolReserves: 0n,
          realTokenReserves: 0n,
          tokenTotalSupply: 0n,
          feeBasisPoints: 0n,
          createdAt: timestamp,
          updatedAt: timestamp
        });
        await this.store.save(curve);
        stats.entities.bondingCurves++;
      }  
      
      // Update the bonding curve to reflect withdrawal (typically zeroing out reserves)
      await this.updateBondingCurve(curve.id, {
        realSolReserves: 0n,
        realTokenReserves: 0n,
        updatedAt: timestamp
      });
      stats.entities.bondingCurves++;
      
      // Extract token ID from the curve
      const tokenId = curve.token ? 
        (typeof curve.token === 'string' ? curve.token : curve.token.toString()) : 
        bondingCurveId;
      
      
      // If we have a token service, mark the associated token as completed
      if (this.tokenService) {
        // Try to get the token, or create a placeholder if it doesn't exist
        const token = await this.tokenService.getToken(tokenId, true); // true to create if not found
        
        if (token) {
          await this.tokenService.updateToken(token.id, {
            status: 'completed',
            updatedAt: timestamp
          });
          stats.entities.tokens++;
          
          // Create completed event
          const eventId = `${txSignature}-${slot}`;
          
          try {
            const completedEvent = await this.tokenService.createTokenCompletedEvent({
              id: eventId,
              token,
              user: userId,
              slot,
              timestamp
            });
            stats.entities.tokenCompleted++;
          } catch (eventError: any) {
            console.error(`Error creating TokenCompleted event: ${eventError.message}`);
          }
        } else {
          console.error(`Failed to get or create token ${tokenId} for TokenCompleted event`);
        }
      } else {
        console.error('TokenService is not available, cannot create TokenCompleted event');
      }
      
    } catch (error: any) {
      console.error(`Error processing withdraw instruction: ${error.message}`);
      console.error(error.stack);
      // Don't rethrow the error to prevent the processor from stopping
    }
  }
}

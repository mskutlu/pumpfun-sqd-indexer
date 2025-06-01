import { BondingCurve } from "../model"
import { StoreWithCache } from '@belopash/typeorm-store'
import { Instruction as SolInstruction } from "@subsquid/solana-objects"
import * as pumpIns from "../abi/pump-fun/instructions"
import { TokenService } from "./token.service"

/**
 * Stores and updates BondingCurve entities.  All reserve deltas are applied
 * in-memory and the final state is persisted at the end of the batch.
 */
export class BondingCurveService {
  constructor(
    private readonly store: StoreWithCache,
    private readonly tokenService?: TokenService
  ) {}


  /**
   * Flush is now a no-op since StoreWithCache handles batching automatically
   */
  async flush(): Promise<void> {
    // No-op as StoreWithCache handles batching
  }
  
  /**
   * Creates a new bonding curve entity using StoreWithCache's optimized methods
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
    // Use StoreWithCache's defer to optimize database access
    this.store.defer(BondingCurve, params.id)
    
    try {
      // Use getOrInsert for optimized entity creation/retrieval
      return await this.store.getOrInsert(BondingCurve, params.id, () => {
        return new BondingCurve(params)
      })
    } catch (error) {
      // Fallback to direct insert on failure
      const curve = new BondingCurve(params)
      await this.store.insert(curve)
      return curve
    }
  }
  
  /**
   * Gets a bonding curve by ID
   */
  async getBondingCurve(id: string): Promise<BondingCurve | undefined> {
    // Use defer to optimize database access
    this.store.defer(BondingCurve, id)
    
    try {
      return await this.store.get(BondingCurve, id)
    } catch (error) {
      return undefined
    }
  }
  
  /**
   * Gets bonding curve by token ID
   */
  async getBondingCurveByToken(tokenId: string): Promise<BondingCurve | undefined> {
    // Find bonding curve by token ID using a database query instead of in-memory search
    try {
      const curves = await this.store.find(BondingCurve, {
        where: { token: { id: tokenId } },
        relations: { token: true }
      })
      return curves.length > 0 ? curves[0] : undefined
    } catch (error) {
      // Try a more basic query if the relational query fails
      try {
        // Get all curves and filter manually
        const allCurves = await this.store.find(BondingCurve, {});
        // Return the first one that matches by tokenId if token field is populated
        return allCurves.find(curve => curve.token && curve.token.id === tokenId);
      } catch (fallbackError) {
        console.warn(`Failed to get bonding curve by token ${tokenId}:`, fallbackError);
        return undefined;
      }
    }
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
    // Use defer to optimize database access
    this.store.defer(BondingCurve, curveId)
    
    try {
      // Get the curve
      const curve = await this.store.get(BondingCurve, curveId)
      if (!curve) return undefined
      
      // Update fields
      if (params.virtualSolReserves !== undefined) curve.virtualSolReserves = params.virtualSolReserves
      if (params.virtualTokenReserves !== undefined) curve.virtualTokenReserves = params.virtualTokenReserves
      if (params.realSolReserves !== undefined) curve.realSolReserves = params.realSolReserves
      if (params.realTokenReserves !== undefined) curve.realTokenReserves = params.realTokenReserves
      if (params.tokenTotalSupply !== undefined) curve.tokenTotalSupply = params.tokenTotalSupply
      if (params.feeBasisPoints !== undefined) curve.feeBasisPoints = params.feeBasisPoints
      curve.updatedAt = params.updatedAt
      
      // Use upsert for optimized updates
      await this.store.upsert(curve)
      return curve
    } catch (error) {
      return undefined
    }
  }

  async getAllCurves(): Promise<BondingCurve[]> {
    return await this.store.find(BondingCurve, {})
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
        await this.store.insert(curve);
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

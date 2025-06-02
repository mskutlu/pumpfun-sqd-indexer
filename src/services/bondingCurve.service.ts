import { BondingCurve } from "../model"
import { StoreWithCache } from '@belopash/typeorm-store'
import { Instruction as SolInstruction } from "@subsquid/solana-objects"
import * as pumpIns from "../abi/pump-fun/instructions"
import { TokenService } from "./token.service"

// Types used by processor context queue
type Task = () => Promise<void>
type ProcessorContext = { store: StoreWithCache, queue: Task[] }

/**
 * Stores and updates BondingCurve entities.  All reserve deltas are applied
 * in-memory and the final state is persisted at the end of the batch.
 */
export class BondingCurveService {
  private processorContext?: { queue: Task[] }
  
  constructor(
    private readonly store: StoreWithCache,
    private readonly tokenService?: TokenService,
    processorContext?: { queue: Task[] }
  ) {
    this.processorContext = processorContext
  }


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
    this.store.defer(BondingCurve, params.id);
    
    try {
      // First check if the curve already exists
      const existing = await this.store.get(BondingCurve, params.id);
      if (existing) {
        // Update existing curve with new params
        existing.virtualSolReserves = params.virtualSolReserves;
        existing.virtualTokenReserves = params.virtualTokenReserves;
        existing.realSolReserves = params.realSolReserves;
        existing.realTokenReserves = params.realTokenReserves;
        existing.tokenTotalSupply = params.tokenTotalSupply;
        existing.feeBasisPoints = params.feeBasisPoints;
        existing.updatedAt = params.updatedAt;
        
        // Only update token if provided and existing is missing one
        if (params.token && (!existing.token || existing.token === null)) {
          existing.token = params.token;
        }
        
        await this.store.upsert(existing);
        return existing;
      }
      
      // Determine if we have a valid token reference
      const tokenRef = params.token;
      let validToken = false;
      let tokenId = '';
      
      if (tokenRef) {
        if (typeof tokenRef === 'string') {
          tokenId = tokenRef;
          // Only check if token exists if tokenService is available
          if (this.tokenService) {
            try {
              const token = await this.tokenService.getToken(tokenId, true);
              if (token) {
                validToken = true;
                params.token = token;
              }
            } catch (tokenError) {
              //console.log(`Token ${tokenId} not available yet for bonding curve ${params.id}`);
            }
          }
        } else if (tokenRef.id) {
          tokenId = tokenRef.id;
          validToken = true;
        }
      }

      // If token is valid, create with token reference
      if (validToken) {
        return await this.store.getOrInsert(BondingCurve, params.id, () => {
          return new BondingCurve(params);
        });
      } 
      
      // If token is not valid but we have a processor context queue, 
      // create without token and queue an update for later
      if (this.processorContext?.queue) {
        // Create curve without token reference to avoid FK constraint issues
        const safeParams = {...params};
        const originalTokenRef = safeParams.token; // Save original reference
        delete safeParams.token; // Remove invalid token reference
        
        // Create the curve first
        const curve = new BondingCurve(safeParams);
        await this.store.insert(curve);
        
        // Queue an update task to set the token reference later
        //console.log(`Queuing bonding curve ${params.id} token reference update for later`);
        this.processorContext.queue.push(async () => {
          try {
            // Get fresh curve data
            const savedCurve = await this.store.get(BondingCurve, params.id);
            if (!savedCurve) return;
            
            // Try to get the token again, it might exist now
            if (this.tokenService && tokenId) {
              const token = await this.tokenService.getToken(tokenId, true);
              if (token) {
                savedCurve.token = token;
                await this.store.upsert(savedCurve);
                //console.log(`Successfully updated bonding curve ${params.id} with token ${tokenId}`);
              }
            } else if (originalTokenRef && typeof originalTokenRef !== 'string') {
              // Try using the original reference directly
              savedCurve.token = originalTokenRef;
              await this.store.upsert(savedCurve);
              console.log(`Updated bonding curve ${params.id} with original token reference`);
            }
          } catch (queuedError) {
            console.warn(`Failed to update bonding curve ${params.id} token from queue:`, queuedError);
          }
        });
        
        return curve;
      } else {
        // Without processor queue, create without token reference as best effort
        console.warn(`Creating bonding curve ${params.id} without token reference - possible FK constraint issues`);
        const safeParams = {...params};
        delete safeParams.token; // Remove invalid token reference
        
        const curve = new BondingCurve(safeParams);
        await this.store.insert(curve);
        return curve;
      }
    } catch (error: any) {
      // Handle transaction abort errors by queuing for later execution
      if (this.processorContext?.queue && error?.driverError?.code === '25P02') {
        //console.log(`Queuing bonding curve creation for ${params.id} after transaction abort`);
        
        // Create a copy of params to avoid mutation issues
        const paramsForQueue = {...params};
        
        // Add to processor queue for later execution when dependencies might be resolved
        this.processorContext.queue.push(async () => {
          try {
            // Try again with a clean slate
            const curve = await this.createBondingCurve(paramsForQueue);
            //console.log(`Successfully created queued bonding curve ${params.id}`);
            // Don't return the curve (void return type needed for Task)
          } catch (queuedError) {
            console.warn(`Still failed to create bonding curve ${params.id} from queue:`, queuedError);
            
            // Last resort - create without token reference
            try {
              const safeParams = {...paramsForQueue};
              delete safeParams.token; // Remove potentially problematic token reference
              
              const curve = new BondingCurve(safeParams);
              await this.store.insert(curve);
              console.log(`Created bonding curve ${params.id} without token reference as last resort`);
            } catch (finalError) {
              console.error(`Complete failure creating bonding curve ${params.id}:`, finalError);
            }
          }
        });
        
        // Return a non-persisted instance for now
        return new BondingCurve(params);
      }
      
      // Re-throw the error if we can't queue it
      console.error(`Failed to create bonding curve ${params.id}:`, error);
      throw error;
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
    this.store.defer(BondingCurve, curveId);
    
    try {
      // Get the curve
      const curve = await this.store.get(BondingCurve, curveId);
      if (!curve) return undefined;
      
      // Update fields
      if (params.virtualSolReserves !== undefined) curve.virtualSolReserves = params.virtualSolReserves
      if (params.virtualTokenReserves !== undefined) curve.virtualTokenReserves = params.virtualTokenReserves
      if (params.realSolReserves !== undefined) curve.realSolReserves = params.realSolReserves
      if (params.realTokenReserves !== undefined) curve.realTokenReserves = params.realTokenReserves
      if (params.tokenTotalSupply !== undefined) curve.tokenTotalSupply = params.tokenTotalSupply
      if (params.feeBasisPoints !== undefined) curve.feeBasisPoints = params.feeBasisPoints
      curve.updatedAt = params.updatedAt;
      
      // Ensure token relationship is valid to prevent FK constraints errors
      if (curve.token === null || curve.token === undefined) {
        // If we have a processor context queue, add a task to try this update later
        // when the token might exist
        if (this.processorContext?.queue) {
          //console.log(`Queuing bonding curve update for ${curveId} - token reference missing`);
          this.processorContext.queue.push(async () => {
            // Check if token exists by the time we process the queue
            if (this.tokenService) {
              const tokenId = typeof curve.token === 'string' ? curve.token : curveId;
              const token = await this.tokenService.getToken(tokenId, true);
              if (token) {
                // Try update again with the token
                curve.token = token;
                try {
                  await this.store.upsert(curve);
                  //console.log(`Successfully updated queued bonding curve ${curveId}`);
                } catch (queuedError) {
                  console.warn(`Still failed to update bonding curve ${curveId} from queue:`, queuedError);
                }
              }
            }
          });
        } else {
          console.warn(`Skipping update for bonding curve ${curveId} - missing token reference`);
        }
        return curve; // Return the in-memory version
      }
      
      // If token relationship is valid, perform the update
      await this.store.upsert(curve);
      return curve;
    } catch (error: any) {
      // If we have a processor context queue, add this task to try again later
      if (this.processorContext?.queue && error?.driverError?.code === '25P02') {
        //console.log(`Queuing bonding curve update for ${curveId} after transaction abort`);
        this.processorContext.queue.push(async () => {
          try {
            // Get fresh curve data
            const curve = await this.store.get(BondingCurve, curveId);
            if (curve) {
              // Update fields
              if (params.virtualSolReserves !== undefined) curve.virtualSolReserves = params.virtualSolReserves
              if (params.virtualTokenReserves !== undefined) curve.virtualTokenReserves = params.virtualTokenReserves
              if (params.realSolReserves !== undefined) curve.realSolReserves = params.realSolReserves
              if (params.realTokenReserves !== undefined) curve.realTokenReserves = params.realTokenReserves
              if (params.tokenTotalSupply !== undefined) curve.tokenTotalSupply = params.tokenTotalSupply
              if (params.feeBasisPoints !== undefined) curve.feeBasisPoints = params.feeBasisPoints
              curve.updatedAt = params.updatedAt;
              
              await this.store.upsert(curve);
              //console.log(`Successfully updated queued bonding curve ${curveId}`);
            }
          } catch (queuedError) {
            console.warn(`Still failed to update bonding curve ${curveId} from queue:`, queuedError);
          }
        });
      } else {
        console.warn(`Failed to update bonding curve ${curveId}:`, error?.message || String(error));
      }
      return undefined;
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

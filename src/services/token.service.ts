import {
  PumpToken,
  TokenCreated,
  TokenCompleted
} from "../model"
import { MemoryStore, StoreManager } from "../store/memory.store"
import { BondingCurveService } from "./bondingCurve.service"
import { Instruction as SolInstruction } from "@subsquid/solana-objects"
import * as pumpIns from "../abi/pump-fun/instructions"
import * as indexes from "../abi/pump-fun/index"
import { GlobalService } from "./global.service"

/**
 * Sanitize a string by removing null bytes and non-UTF8 characters
 * that would cause PostgreSQL errors
 */
function sanitizeString(input: any): string {
  if (input === null || input === undefined) return '';
  
  // Convert to string if it's not already
  const str = input.toString();
  
  // Remove null bytes and other control characters that PostgreSQL doesn't like
  return str.replace(/\u0000|[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

export class TokenService {
  private readonly tokenStore: MemoryStore<PumpToken>
  private readonly createdStore: MemoryStore<TokenCreated>
  private readonly completedStore: MemoryStore<TokenCompleted>

  constructor(
    private readonly storeManager: StoreManager,
    private readonly curveService: BondingCurveService,
    private readonly globalService?: GlobalService
  ) {
    this.tokenStore = storeManager.getStore<PumpToken>("PumpToken")
    this.createdStore = storeManager.getStore<TokenCreated>(
      "TokenCreated"
    )
    this.completedStore = storeManager.getStore<TokenCompleted>(
      "TokenCompleted"
    )
  }
  
  /**
   * Flush any pending token entities to the database
   */
  async flush(): Promise<void> {
    await this.tokenStore.flush();
    await this.createdStore.flush();
    await this.completedStore.flush();
  }
  
  /**
   * Get all tokens
   */
  getAllTokens(): PumpToken[] {
    return this.tokenStore.getAll()
  }
  
  /**
   * Get all token created events
   */
  getAllTokenCreatedEvents(): TokenCreated[] {
    return this.createdStore.getAll()
  }
  
  /**
   * Get all token completed events
   */
  getAllTokenCompletedEvents(): TokenCompleted[] {
    return this.completedStore.getAll()
  }
  
  /**
   * Creates a new token entity and saves it to the store
   */
  async createToken(params: {
    id: string
    name: string
    symbol: string
    decimals: number
    creator: string
    status: string
    createdAt: Date
    updatedAt: Date
  }): Promise<PumpToken> {
    let token = await this.tokenStore.find(params.id)
    if (token) return token // already created inside same batch
    
    token = new PumpToken(params)
    await this.tokenStore.save(token)
    return token
  }
  
  /**
   * Gets a token by its mint address or creates a placeholder if needed
   * @param mint The token mint address
   * @param createIfMissing Whether to create a placeholder token if not found
   * @returns The token or undefined if not found and not creating
   */
  async getToken(mint: string, createIfMissing = false): Promise<PumpToken | undefined> {
    // First check in memory
    let token = await this.tokenStore.find(mint);
    
    // If not in memory, try to find in database
    if (!token) {
      try {
        token = await this.storeManager.ctx.store.get(PumpToken, mint);
        if (token) {
          // Add to memory store for future access
          await this.tokenStore.save(token);
        }
      } catch (err) {
        console.error(`Error loading token ${mint} from database:`, err);
      }
    }
    
    // Create a placeholder token if requested and not found
    if (!token && createIfMissing) {
      token = new PumpToken({
        id: mint,
        name: mint,
        symbol: mint,
        decimals: 9,
        creator: mint,
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date()
      });
      await this.tokenStore.save(token);
    }
    
    return token;
  }
  
  /**
   * Updates an existing token with new data
   */
  async updateToken(tokenId: string, params: {
    status?: string
    updatedAt: Date
  }): Promise<PumpToken | undefined> {
    const token = await this.tokenStore.find(tokenId)
    if (!token) return undefined
    
    if (params.status) token.status = params.status
    token.updatedAt = params.updatedAt
    
    await this.tokenStore.save(token)
    return token
  }
  
  /**
   * Creates a TokenCreated event entity
   */
  async createTokenCreatedEvent(params: {
    id: string
    token: PumpToken
    user: string
    uri: string
    slot: number
    timestamp: Date
  }): Promise<TokenCreated> {
    // Ensure timestamp is properly formatted
    let eventTimestamp = params.timestamp;
    if (!(params.timestamp instanceof Date)) {
      // If timestamp appears to be in seconds (pre-2021), convert to milliseconds
      if (typeof params.timestamp === 'number' && params.timestamp < 1600000000000) {
        eventTimestamp = new Date(params.timestamp * 1000);
      } else {
        eventTimestamp = new Date(params.timestamp);
      }
    }
    
    const created = new TokenCreated({
      ...params,
      timestamp: eventTimestamp
    });
    await this.createdStore.save(created);
    return created;
  }
  
  /**
   * Creates a TokenCompleted event entity
   */
  async createTokenCompletedEvent(params: {
    id: string
    token: PumpToken
    user: string
    slot: number
    timestamp: Date
  }): Promise<TokenCompleted> {
    // Ensure timestamp is properly formatted
    let eventTimestamp = params.timestamp;
    if (!(params.timestamp instanceof Date)) {
      // If timestamp appears to be in seconds (pre-2021), convert to milliseconds
      if (typeof params.timestamp === 'number' && params.timestamp < 1600000000000) {
        eventTimestamp = new Date(params.timestamp * 1000);
      } else {
        eventTimestamp = new Date(params.timestamp);
      }
    }
    
    const completed = new TokenCompleted({
      ...params,
      timestamp: eventTimestamp
    });
    await this.completedStore.save(completed);
    return completed;
  }
  
  /**
   * Process a create instruction directly from instruction data
   */
  async processCreateInstruction(
    context: { instruction: SolInstruction; timestamp: Date; slot: number; txSignature: string },
    stats: any
  ): Promise<void> {
    const { instruction, timestamp, slot, txSignature } = context;
    
    try {
      const inner = instruction.inner.filter(f=> f.programId.toLowerCase() === indexes.PROGRAM_ID.toLowerCase()
            && f.accounts[0].toLowerCase() === indexes.EVENT_AUTHORITY.toLowerCase() && f.d8 === pumpIns.createInstruction.d8 );
      // Decode the instruction
      const decoded = pumpIns.createInstruction.decode(inner[0]);
      if (!decoded || !decoded.data) {
        console.error('Failed to decode create instruction');
        return;
      }
      const { name, symbol, uri, mint, bondingCurve, user } = decoded.data;
      
      // Get curve parameters from global config (or use defaults)
      const curveParams = this.globalService?.getCurveParameters() || {
        initialVirtualTokenReserves: 1000000n,
        initialVirtualSolReserves: 1000000n,
        initialRealTokenReserves: 0n,
        tokenTotalSupply: 1000000000n
      };
      
      // Create the token
      await this.createToken({
        id: sanitizeString(mint),
        name: sanitizeString(name), 
        symbol: sanitizeString(symbol),
        decimals: 6, 
        creator: sanitizeString(user),
        status: 'active',
        createdAt: timestamp,
        updatedAt: timestamp
      });
      stats.entities.tokens++;
      
      // Create the bonding curve
      await this.curveService.createBondingCurve({
        id: sanitizeString(bondingCurve),
        token: sanitizeString(mint),
        virtualSolReserves: curveParams.initialVirtualSolReserves,
        virtualTokenReserves: curveParams.initialVirtualTokenReserves,
        realSolReserves: 0n,
        realTokenReserves: curveParams.initialRealTokenReserves,
        tokenTotalSupply: curveParams.tokenTotalSupply,
        feeBasisPoints: 30n, 
        createdAt: timestamp,
        updatedAt: timestamp
      });
      stats.entities.bondingCurves++;
      
      // Create token created event using the token entity we just created
      const tokenObject = await this.getToken(sanitizeString(mint));
      if (tokenObject) {
        await this.createTokenCreatedEvent({
          id: `${txSignature}-${slot}`,
          token: tokenObject,
          user: sanitizeString(user),
          uri: sanitizeString(uri),
          slot,
          timestamp
        });
        stats.entities.tokenCreated++;
      }
      
    } catch (error) {
      console.error('Error processing create instruction:', error);
      throw error;
    }
  }
}

import {
  PumpToken,
  TokenCreated,
  TokenCompleted
} from "../model"
import { StoreWithCache } from '@belopash/typeorm-store'
import { BondingCurveService } from "./bondingCurve.service"
import { Instruction as SolInstruction } from "@subsquid/solana-objects"
import * as pumpIns from "../abi/pump-fun/instructions"
import * as indexes from "../abi/pump-fun/index"
import { GlobalService } from "./global.service"

/**
 * Sanitize a string by removing null bytes, non-UTF8 characters,
 * trimming whitespace, and validating input to prevent PostgreSQL errors
 */
function sanitizeString(input: string | null | undefined): string {
  if (input === null || input === undefined) return '';
  
  // Convert to string if it's not already and trim whitespace
  const str = input.toString().trim();
  
  // If it's empty after trimming, return empty string
  if (str.length === 0) return '';
  
  // If it's extremely long, truncate it
  const sanitized = str.length > 100 ? str.substring(0, 100) : str;
  
  // Remove null bytes and other control characters that PostgreSQL doesn't like
  return sanitized.replace(/\u0000|[\u0001-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

export class TokenService {
  constructor(
    private readonly store: StoreWithCache,
    private readonly curveService: BondingCurveService,
    private readonly globalService?: GlobalService
  ) {}

  
  /**
   * Flush is now a no-op since StoreWithCache handles batching automatically
   */
  async flush(): Promise<void> {
    // No-op as StoreWithCache handles batching
  }
  
  /**
   * Get all tokens
   */
  async getAllTokens(): Promise<PumpToken[]> {
    return await this.store.find(PumpToken, {})
  }
  
  // Methods for TokenEvent and TokenHolding have been removed as these entities don't exist in the model
  
  /**
   * Get all token created events
   */
  async getAllTokenCreatedEvents(): Promise<TokenCreated[]> {
    return await this.store.find(TokenCreated, {})
  }
  
  /**
   * Get all token completed events
   */
  async getAllTokenCompletedEvents(): Promise<TokenCompleted[]> {
    return await this.store.find(TokenCompleted, {})
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
    // Use StoreWithCache's defer to optimize database access
    this.store.defer(PumpToken, params.id)
    
    try {
      // Use getOrInsert for optimized entity creation/retrieval
      return await this.store.getOrInsert(PumpToken, params.id, () => {
        return new PumpToken(params)
      })
    } catch (error) {
      // Fallback to direct insert on failure
      const token = new PumpToken(params)
      await this.store.insert(token)
      return token
    }
  }
  
  /**
   * Gets a token by its mint address or creates a placeholder if needed
   * @param mint The token mint address
   * @param createIfMissing Whether to create a placeholder token if not found
   * @returns The token or undefined if not found and not creating
   */
  async getToken(mint: string, createIfMissing = false): Promise<PumpToken | undefined> {
    // Sanitize mint address - common source of errors
    const tokenId = sanitizeString(mint);
    if (!tokenId) {
      console.warn("Invalid token mint address");
      return undefined;
    }
    
    // Use defer to optimize database access
    this.store.defer(PumpToken, tokenId)
    
    if (createIfMissing) {
      try {
        // First try to get
        try {
          const token = await this.store.get(PumpToken, tokenId)
          if (token) return token
        } catch (getError) {
          // Ignore get error and continue to create
        }
        
        // Create new token with sanitized fields
        const newToken = new PumpToken({
          id: tokenId,
          name: tokenId.substring(0, 12) + '...', // Truncate for safety
          symbol: tokenId.substring(0, 6),         // Short symbol for safety
          decimals: 9,
          creator: tokenId,
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date()
        })
        
        // Try insert, fall back to upsert
        try {
          await this.store.insert(newToken)
          return newToken
        } catch (insertError) {
          // If insert fails, try upsert
          try {
            await this.store.upsert(newToken)
            return newToken
          } catch (upsertError) {
            console.warn(`Failed to create token ${tokenId}:`, upsertError)
            return undefined
          }
        }
      } catch (error) {
        console.warn(`Error in getToken for ${tokenId}:`, error)
        return undefined
      }
    } else {
      // Just try to get the token
      try {
        return await this.store.get(PumpToken, tokenId)
      } catch (error) {
        console.warn(`Error fetching token ${tokenId}:`, error)
        return undefined
      }
    }
  }
  
  /**
   * Updates an existing token with new data
   */
  async updateToken(tokenId: string, params: {
    status?: string
    updatedAt: Date
  }): Promise<PumpToken | undefined> {
    try {
      // Use defer to optimize database access
      this.store.defer(PumpToken, tokenId)
      
      // Get the token
      const token = await this.store.get(PumpToken, tokenId)
      if (!token) return undefined
      
      // Update fields
      if (params.status) token.status = params.status
      token.updatedAt = params.updatedAt
      
      // Use upsert for optimized updates
      await this.store.upsert(token)
      return token
    } catch (error) {
      return undefined
    }
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
    
    // For event entities, use direct insert since they're new records and don't need upserts
    try {
      const created = new TokenCreated({
        ...params,
        timestamp: eventTimestamp
      });
      await this.store.insert(created);
      return created;
    } catch (error) {
      // Fallback to slower but safer upsert if insert fails
      const created = new TokenCreated({
        ...params,
        timestamp: eventTimestamp
      });
      await this.store.upsert(created);
      return created;
    }
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
    
    // For event entities, use direct insert since they're new records and don't need upserts
    try {
      const completed = new TokenCompleted({
        ...params,
        timestamp: eventTimestamp
      });
      await this.store.insert(completed);
      return completed;
    } catch (error) {
      // Fallback to slower but safer upsert if insert fails
      const completed = new TokenCompleted({
        ...params,
        timestamp: eventTimestamp
      });
      await this.store.upsert(completed);
      return completed;
    }
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

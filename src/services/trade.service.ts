import {Trade, PumpToken, BondingCurve} from "../model"
import { MemoryStore, StoreManager } from "../store/memory.store"
import { Instruction as SolInstruction } from "@subsquid/solana-objects"
import * as pumpIns from "../abi/pump-fun/instructions"
import * as indexes from "../abi/pump-fun/index"
import { TokenService } from "./token.service"
import { BondingCurveService } from "./bondingCurve.service"
import { WalletStatsService } from "./walletStats.service"
import { withTimer } from "../utils/timeLogger"

export class TradeService {
  private readonly store: MemoryStore<Trade>

  private txLogCounter: { [key: string]: number } = {}

  constructor(
    private readonly storeManager: StoreManager,
    private readonly tokenService?: TokenService,
    private readonly curveService?: BondingCurveService,
    private readonly walletStatsService?: import("./walletStats.service").WalletStatsService
  ) {
    this.store = storeManager.getStore<Trade>("Trade")
  }

  /**
   * Flush any pending trade entities to the database
   */
  async flush(): Promise<void> {
    await this.store.flush();
  }

  private nextIndex(txId: string): number {
    const i = this.txLogCounter[txId] || 0
    this.txLogCounter[txId] = i + 1
    return i
  }

  /**
   * Create a new trade entity
   */
  async createTrade(
    paramOrTxId: string | {
      id: string
      token: PumpToken
      user: string
      isBuy: boolean
      solAmount: bigint
      tokenAmount: bigint
      virtualSolReserves: bigint
      virtualTokenReserves: bigint
      realSolReserves: bigint
      realTokenReserves: bigint
      txSignature: string
      slot: number
      timestamp: Date
    },
    token?: PumpToken,
    user?: string,
    isBuy?: boolean,
    solAmount?: bigint,
    tokenAmount?: bigint,
    vSol?: bigint,
    vToken?: bigint,
    rSol?: bigint,
    rToken?: bigint,
    slot?: number,
    timestamp?: number
  ): Promise<Trade> {
    // Object parameter version
    if (typeof paramOrTxId === 'object') {
      const params = paramOrTxId;
      // Create trade entity with given params
      // Ensure timestamp is a proper Date object
      let tradeTimestamp = params.timestamp;
      // If it's not a Date object already, ensure it's properly converted
      if (!(params.timestamp instanceof Date)) {
        // If timestamp appears to be in seconds (pre-2021), convert to milliseconds
        if (typeof params.timestamp === 'number' && params.timestamp < 1600000000000) {
          tradeTimestamp = new Date(params.timestamp * 1000);
        } else {
          tradeTimestamp = new Date(params.timestamp);
        }
      }
      
      const trade = new Trade({
        id: params.id,
        token: params.token,
        user: params.user,
        isBuy: params.isBuy,
        solAmount: params.solAmount,
        tokenAmount: params.tokenAmount,
        virtualSolReserves: params.virtualSolReserves,
        virtualTokenReserves: params.virtualTokenReserves,
        realSolReserves: params.realSolReserves,
        realTokenReserves: params.realTokenReserves,
        slot: params.slot,
        timestamp: tradeTimestamp
      });
      
      await this.store.save(trade);

      return trade;
    } 
    // Individual parameter version
    else {
      const txId = paramOrTxId;
      if (!token || user === undefined || isBuy === undefined || !solAmount || !tokenAmount || 
          vSol === undefined || vToken === undefined || rSol === undefined || rToken === undefined || 
          slot === undefined || timestamp === undefined) {
        throw new Error('Missing required parameters for createTrade');
      }
      
      const id = `${txId}-${this.nextIndex(txId)}`;
      // Set initial real reserves - we'll prefer using the provided rSol and rToken if available
      let realSolReserves = rSol !== undefined ? rSol : 0n;
      let realTokenReserves = rToken !== undefined ? rToken : 0n;
      
      // If real reserves weren't provided, estimate based on virtual reserves and trade type
      if (realSolReserves === 0n && realTokenReserves === 0n) {
        if (isBuy) {
          // When buying, SOL increases and tokens decrease
          realSolReserves = vSol * 3n / 10n; // ~30% of virtual as real reserves
          realTokenReserves = vToken * 8n / 10n; // ~80% of virtual as real tokens
        } else {
          // When selling, SOL decreases and tokens increase
          realSolReserves = vSol * 7n / 10n; // ~70% of virtual as real reserves
          realTokenReserves = vToken * 2n / 10n; // ~20% of virtual as real tokens
        }
      }
      
      const trade = new Trade({
        id,
        token,
        user,
        isBuy,
        solAmount,
        tokenAmount,
        virtualSolReserves: vSol,
        virtualTokenReserves: vToken,
        realSolReserves,
        realTokenReserves,
        slot,
        timestamp: new Date(timestamp * 1000)
      });
      
      await this.store.save(trade);
      
      return trade;
    }
  }
  
  /**
   * Get all trades from storage
   */
  getAllTrades(): Trade[] {
    return this.store.getAll();
  }

  /**
   * Process a trade instruction directly from instruction data
   * This handles the tradeEventInstruction which contains all necessary data
   */
  async processTradeInstruction(
    context: { instruction: SolInstruction; timestamp: Date; slot: number; txSignature: string },
    stats: any
  ): Promise<void> {
    const { instruction, timestamp, slot, txSignature } = context;
    
    try {
      const inner = instruction.inner.filter(f=> f.programId.toLowerCase() === indexes.PROGRAM_ID.toLowerCase()
      && f.accounts[0].toLowerCase() === indexes.EVENT_AUTHORITY.toLowerCase() && f.d8 === pumpIns.tradeEventInstruction.d8 );
      if(inner.length === 0)
        return;
      let decodedInnerInstruction;
      for(const i of inner) {
        try {
          decodedInnerInstruction = pumpIns.tradeEventInstruction.decode(i);
        } catch (error) {
        // ignore, try next instruction
        // sometimes it can contains other instructions with same d8 and it cant be decodedInnerInstruction.
        }
      }
      if (!decodedInnerInstruction || !decodedInnerInstruction.data) {
        console.error('Failed to decode trade event instruction', txSignature);
        return;
      }
      
      const {
        mint, solAmount, tokenAmount, isBuy, user, 
        virtualSolReserves, virtualTokenReserves
      } = decodedInnerInstruction.data;

      // Decode the main instruction based on whether it's a buy or sell
      let decodedInstruction;
      if (isBuy) {
        decodedInstruction = pumpIns.buy.decode(instruction);
      }
      else {
        decodedInstruction = pumpIns.sell.decode(instruction);
      }
      
      // Get the accounts from the decoded instruction
      const { accounts } = decodedInstruction;
      const { bondingCurve: bondingCurveAccount } = accounts;

      // Calculate estimated real reserves based on virtual reserves and trade type
      // Initial values - we'll try to get actual values from the bonding curve later
      let realSolReserves: bigint;
      let realTokenReserves: bigint;
      
      // Estimate based on virtual reserves and trade type
      if (isBuy) {
        // When buying, SOL increases and tokens decrease
        realSolReserves = virtualSolReserves * 3n / 10n; // ~30% of virtual as real reserves
        realTokenReserves = virtualTokenReserves * 8n / 10n; // ~80% of virtual as real tokens
      } else {
        // When selling, SOL decreases and tokens increase
        realSolReserves = virtualSolReserves * 7n / 10n; // ~70% of virtual as real reserves
        realTokenReserves = virtualTokenReserves * 2n / 10n; // ~20% of virtual as real tokens
      }

      // We need to get the token for this trade
      let token: PumpToken | undefined;
      if (this.tokenService) {
        token = await this.tokenService.getToken(mint.toString(), true); // Create placeholder if needed
      }

      if (!token) {
        console.error(`Failed to get or create token ${mint.toString()} for trade event`);
        return;
      }

      // Create the trade record
      await this.createTrade({
        id: `${txSignature}-${this.nextIndex(txSignature)}`,
        token,
        user: user.toString(),
        isBuy,
        solAmount,
        tokenAmount,
        virtualSolReserves,
        virtualTokenReserves,
        realSolReserves,
        realTokenReserves,
        txSignature,
        slot,
        timestamp
      });
      stats.entities.trades++;

      // Apply wallet-level analytics
      if (this.walletStatsService) {
        await this.walletStatsService.applyTrade({
          wallet: user.toString(),
          token,
          isBuy,
          solAmount,
          timestamp
        });
      }

      // Update the bonding curve if available
      if (this.curveService) {
        let bondingCurve = bondingCurveAccount ?
          await this.curveService.getBondingCurve(bondingCurveAccount.toString()) : undefined;

        if (bondingCurve) {
          // Use the existing real reserves as our starting point
          realSolReserves = bondingCurve.realSolReserves;
          realTokenReserves = bondingCurve.realTokenReserves;
          
          // Update real reserves based on trade activity according to AMM logic
          if (isBuy) {
            // When buying: SOL goes in, tokens come out
            realSolReserves = realSolReserves + solAmount;
            realTokenReserves = realTokenReserves - tokenAmount;
          } else {
            // When selling: tokens go in, SOL comes out
            realSolReserves = realSolReserves - solAmount;
            realTokenReserves = realTokenReserves + tokenAmount;
          }
          
          // Ensure we don't go negative
          if (realSolReserves < 0n) realSolReserves = 0n;
          if (realTokenReserves < 0n) realTokenReserves = 0n;
          // Update reserves
          await this.curveService.updateBondingCurve(bondingCurve.id, {
            virtualSolReserves,
            virtualTokenReserves,
            realSolReserves,
            realTokenReserves,
            updatedAt: timestamp
          });
          stats.entities.bondingCurves++;
        }
        else {
          // Update real reserves based on trade activity according to AMM logic
          if (isBuy) {
            // When buying: SOL goes in, tokens come out
            realSolReserves =  solAmount;
            realTokenReserves = -tokenAmount;
          } else {
            // When selling: tokens go in, SOL comes out
            realSolReserves = -solAmount;
            realTokenReserves =  tokenAmount;
          }
          const curve = new BondingCurve({
            id: bondingCurveAccount,
            token: null as any, // Placeholder for token relationship
            virtualSolReserves: virtualSolReserves,
            virtualTokenReserves: virtualTokenReserves,
            realSolReserves: realSolReserves,
            realTokenReserves: realTokenReserves,
            tokenTotalSupply: 1000000000n,
            feeBasisPoints: 30n,
            createdAt: timestamp,
            updatedAt: timestamp
          });
          await this.curveService.saveForBatchLoading(curve);
        }
      }
      
    } catch (error) {
      console.error('Error processing trade instruction:', error)
    }
  }
}

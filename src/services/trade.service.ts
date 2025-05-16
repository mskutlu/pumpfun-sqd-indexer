import { Trade, PumpToken } from "../model"
import { MemoryStore, StoreManager } from "../store/memory.store"
import { Instruction as SolInstruction } from "@subsquid/solana-objects"
import * as pumpIns from "../abi/pump-fun/instructions"
import * as indexes from "../abi/pump-fun/index"
import { TokenService } from "./token.service"
import { BondingCurveService } from "./bondingCurve.service"

export class TradeService {
  private readonly store: MemoryStore<Trade>

  private txLogCounter: { [key: string]: number } = {}
  // Map to track trades by transaction ID prefix
  private readonly tradesByTxId = new Map<string, Trade[]>()
  // Track pending trades that need log data
  private readonly pendingLogData = new Map<string, boolean>()

  constructor(
    private readonly storeManager: StoreManager,
    private readonly tokenService?: TokenService,
    private readonly curveService?: BondingCurveService
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
        timestamp: params.timestamp
      });
      
      await this.store.save(trade);
      
      // Add to our txId index for quick lookups
      if (!this.tradesByTxId.has(params.txSignature)) {
        this.tradesByTxId.set(params.txSignature, []);
      }
      this.tradesByTxId.get(params.txSignature)?.push(trade);
      
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
      const trade = new Trade({
        id,
        token,
        user,
        isBuy,
        solAmount,
        tokenAmount,
        virtualSolReserves: vSol,
        virtualTokenReserves: vToken,
        realSolReserves: rSol,
        realTokenReserves: rToken,
        slot,
        timestamp: new Date(timestamp * 1000)
      });
      
      await this.store.save(trade);
      
      // Also add to our txId index for quick lookups
      if (!this.tradesByTxId.has(txId)) {
        this.tradesByTxId.set(txId, []);
      }
      this.tradesByTxId.get(txId)?.push(trade);
      
      // Mark if this trade is waiting for log data
      if (vSol === BigInt(0) && vToken === BigInt(0)) {
        this.pendingLogData.set(txId, true);
      }
      
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
      if(inner.length === 0 || txSignature === 'unknown')
        return;
      let decoded;
      for(const i of inner) {
        try {
          decoded = pumpIns.tradeEventInstruction.decode(i);
        } catch (error) {
        // ignore, try next instruction
        // sometimes it can contains other instructions with same d8 and it cant be decoded.
        }
      }
      if (!decoded || !decoded.data) {
        console.error('Failed to decode trade event instruction', txSignature);
        return;
      }
      
      const {
        mint, solAmount, tokenAmount, isBuy, user, 
        virtualSolReserves, virtualTokenReserves
      } = decoded.data;
      
      // Real reserves may or may not be included in the event, initialize to 0
      const realSolReserves = 0n;
      const realTokenReserves = 0n;
      
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
      
      // Update the bonding curve if available
      if (this.curveService) {
        const bondingCurve = await this.curveService.getBondingCurveByToken(token.id);
        if (bondingCurve) {
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
      }
      
    } catch (error) {
      console.error('Error processing trade instruction:', error);
      console.log('txSignature', txSignature)
      const inner = instruction.inner.filter(f=> f.programId.toLowerCase() === indexes.PROGRAM_ID.toLowerCase()
      && f.accounts[0].toLowerCase() === indexes.EVENT_AUTHORITY.toLowerCase() && f.d8 === pumpIns.tradeEventInstruction.d8 );
      console.log('inner', inner);
      throw error;
    }
  }
}

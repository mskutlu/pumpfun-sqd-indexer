import { DataHandlerContext } from "@subsquid/batch-processor"
import { Store } from "@subsquid/typeorm-store"
import { augmentBlock } from "@subsquid/solana-objects"

// Import service classes
import { StoreManager } from "./store/memory.store"
import { GlobalService } from "./services/global.service"
import { BondingCurveService } from "./services/bondingCurve.service"
import { TokenService } from "./services/token.service"
import { TradeService } from "./services/trade.service"

// Import Pump.fun ABI layouts
import * as pumpIns from "./abi/pump-fun/instructions"
import { PROGRAM_ID } from "./abi/pump-fun"

// ===================================================================
// PRE-COMPUTE THE LAYOUT MAP (OUTSIDE the handle function)
// ===================================================================
// This creates a Map for O(1) lookups: 'd8_string' -> layout_object
const instructionLayoutMap = new Map(
  Object.values(pumpIns).map(layout => [layout.d8, layout])
);
// ===================================================================

// Statistics tracking interface
interface ProcessingStats {
  processed: {
    blocks: number;
    instructions: number;
  };
  instructions: {
    initialize: number;
    setParams: number;
    create: number;
    withdraw: number;
    trade: number;
    unknown: number;
  };
  entities: {
    tokens: number;
    bondingCurves: number;
    trades: number;
    globalConfigs: number;
    tokenCreated: number;
    tokenCompleted: number;
  };
}


/**
 * Batch handler passed to Subsquid `run()`.
 */
export async function handle(ctx: DataHandlerContext<any, Store>) {

  // Initialize service layer with proper dependencies
  const storeManager = new StoreManager(ctx);
  
  // Create services with circular dependencies resolved
  const globalService = new GlobalService(storeManager);
  
  const curveService = new BondingCurveService(storeManager); // tokenService not needed in constructor
  const tokenService = new TokenService(storeManager, curveService, globalService);
  
  // Resolve circular dependency
  Object.defineProperty(curveService, 'tokenService', { value: tokenService, writable: false });
  
  // Trade service needs both TokenService and CurveService
  const tradeService = new TradeService(storeManager, tokenService, curveService)
  
  // Stats tracking
  const stats: ProcessingStats = {
    processed: {
      blocks: 0,
      instructions: 0
    },
    instructions: {
      initialize: 0,
      setParams: 0,
      create: 0,
      withdraw: 0,
      trade: 0,
      unknown: 0
    },
    entities: {
      tokens: 0,
      bondingCurves: 0,
      trades: 0,
      globalConfigs: 0,
      tokenCreated: 0,
      tokenCompleted: 0
    }
  };
  
  // Convert blocks once using augmentBlock
  const blocks = ctx.blocks.map(augmentBlock);
  stats.processed.blocks = blocks.length;

  // Pre-sanitize common values
  const unknownSignature = 'unknown';

  // Iterate through blocks and instructions in a single-pass optimized loop
  for (const block of blocks) {
    // Fix timestamp conversion - Solana timestamps need proper conversion
    // Convert timestamp to milliseconds if it's in seconds
    const timestamp = new Date(
      typeof block.header.timestamp === 'number' && block.header.timestamp < 5000000000 
      ? block.header.timestamp * 1000  // Convert seconds to milliseconds
        : block.header.timestamp         // Already in milliseconds
    );
    const slot = block.header.slot;
    
    for (const instruction of block.instructions) {
      // Skip non-PumpFun instructions early
      if (instruction.programId !== PROGRAM_ID) continue;
      stats.processed.instructions++;

      try {
        // Use the pre-computed Map for O(1) lookup
        const layout = instructionLayoutMap.get(instruction.d8);
        if (!layout) {
          stats.instructions.unknown++;
          // console.log(`Unknown instruction layout: ${instruction.d8}`);
          continue;
        }

        // Get transaction signature once
        const txSignature = instruction.transaction?.signatures?.[0] || unknownSignature;
        
        // Process instruction based on layout type using a switch for fastest dispatch
        switch (layout.d8) {
          case pumpIns.initialize.d8:
            stats.instructions.initialize++;
            await globalService.processInitializeInstruction(instruction, timestamp, slot, txSignature, stats);
            break;

          case pumpIns.setParams.d8:
            stats.instructions.setParams++;
            await globalService.processSetParamsInstruction(instruction, timestamp, slot, txSignature, stats);
            break;

          case pumpIns.create.d8:
            stats.instructions.create++;
            await tokenService.processCreateInstruction(instruction, timestamp, slot, txSignature, stats);
            break;

          case pumpIns.withdraw.d8:
            stats.instructions.withdraw++;
            await curveService.processWithdrawInstruction(instruction, timestamp, slot, txSignature, stats);
            break;

          case pumpIns.buy.d8:
          case pumpIns.sell.d8:
            stats.instructions.trade++;
            await tradeService.processTradeInstruction(instruction, timestamp, slot, txSignature, stats);
            break;

          default:
            stats.instructions.unknown++;
        }
      } catch (error) {
        console.error(`Error processing instruction:`, error);
      }
    }
  }

  // At the end of the batch, perform a single, ordered save operation.
  // This replaces all the individual flush() calls.
  await storeManager.save();
  
  // Log stats
  // console.log(`--- Processing Statistics ---`);
  // console.log(`Processed ${stats.processed.blocks} blocks with ${stats.processed.instructions} instructions`);
  // console.log(`\nInstructions processed:`);
  // console.log(`- Initialize: ${stats.instructions.initialize}`);
  // console.log(`- SetParams: ${stats.instructions.setParams}`);
  // console.log(`- Create: ${stats.instructions.create}`);
  // console.log(`- Withdraw: ${stats.instructions.withdraw}`);
  // console.log(`- Trade: ${stats.instructions.trade}`);
  // console.log(`- Unknown: ${stats.instructions.unknown}`);
  // console.log(`\nEntity updates:`);
  // console.log(`- Tokens: ${stats.entities.tokens}`);
  // console.log(`- BondingCurves: ${stats.entities.bondingCurves}`);
  // console.log(`- Trades: ${stats.entities.trades}`);
  // console.log(`- GlobalConfigs: ${stats.entities.globalConfigs}`);
  // console.log(`- TokenCreated events: ${stats.entities.tokenCreated}`);
  // console.log(`- TokenCompleted events: ${stats.entities.tokenCompleted}`);
  // console.log('==== PROCESSOR COMPLETED ====');
}



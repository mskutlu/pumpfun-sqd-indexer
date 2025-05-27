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
  console.log('==== PROCESSOR STARTING ====');
  
  // Initialize service layer with proper dependencies
  const storeManager = new StoreManager(ctx);
  
  // Create services with circular dependencies resolved
  const globalService = new GlobalService(storeManager);
  
  // TokenService needs CurveService but CurveService also needs TokenService
  // We'll create them separately and then set dependencies
  const curveService = new BondingCurveService(storeManager);
  const tokenService = new TokenService(storeManager, curveService, globalService);
  
  // Now that we have TokenService, we can set it in CurveService
  Object.defineProperty(curveService, 'tokenService', {
    value: tokenService,
    writable: false
  });
  
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
  
  // Process blocks
  console.log(`Processing ${ctx.blocks.length} blocks`);
  const blocks = ctx.blocks.map(augmentBlock);

  stats.processed.blocks = blocks.length;

  // Iterate through blocks and instructions
  for (const block of blocks) {
    const timestamp = new Date(block.header.timestamp);
    const slot = block.header.slot;
    for (const instruction of block.instructions) {
      // Skip non-PumpFun instructions
      if (instruction.programId !== PROGRAM_ID) continue;
      stats.processed.instructions++;

      try {
        // Identify which instruction layout we have
        const layout = Object.values(pumpIns).find(i => i.d8 === instruction.d8);
        if (!layout) {
          stats.instructions.unknown++;
          console.log(`Unknown instruction layout: ${instruction.d8}`);
          continue;
        }

        const txSignature = instruction.transaction?.signatures?.[0] || 'unknown';
        const instructionContext = {instruction, timestamp, slot, txSignature};
      
        // Process instruction based on type - delegate to appropriate service
        switch (layout.d8) {
          case pumpIns.initialize.d8:
            stats.instructions.initialize++;
            await globalService.processInitializeInstruction(instructionContext, stats);
           
            break;

          case pumpIns.setParams.d8:
            stats.instructions.setParams++;
            await globalService.processSetParamsInstruction(instructionContext, stats);
           
            break;

          case pumpIns.create.d8:
            stats.instructions.create++;
            await tokenService.processCreateInstruction(instructionContext, stats);
           
            break;

          case pumpIns.withdraw.d8:
            stats.instructions.withdraw++;
            await curveService.processWithdrawInstruction(instructionContext, stats);
           
            break;

          case pumpIns.buy.d8:
          case pumpIns.sell.d8:
            stats.instructions.trade++;
            await tradeService.processTradeInstruction(instructionContext, stats);
           
            break;

          default:
            stats.instructions.unknown++;
        }
      } catch (error) {
        console.error(`Error processing instruction:`, error);
      }
    }
  }

  // Flush any remaining entities in memory to the database
  await tokenService.flush();
  await curveService.flush();
  await tradeService.flush();
  await globalService.flush();
  
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



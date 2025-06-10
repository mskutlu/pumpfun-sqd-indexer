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

const instructionLayoutMap = new Map(
  Object.values(pumpIns).map(layout => [layout.d8, layout])
);

// Performance tracking
const performance = {
  totalTime: 0,
  blockProcessingTime: 0,
  instructionProcessingTime: 0,
  databaseSaveTime: 0,
  count: 0,
  startTime: Date.now(),
  logInterval: 10000 // Log every 10 seconds
};

// Last time we logged performance metrics
let lastLogTime = Date.now();

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
    unknownlayout:  number;
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
  const blockStartTime = Date.now();
  performance.count++;

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
      unknown: 0,
      unknownlayout: 0
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

  // Iterate through blocks and instructions
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
      // Skip non-PumpFun instructions
      if (instruction.programId !== PROGRAM_ID) continue;
      stats.processed.instructions++;

      try {
        // Identify which instruction layout we have
        const layout = Object.values(pumpIns).find(i => i.d8 === instruction.d8);
        if (!layout) {
          stats.instructions.unknownlayout++;
          console.log(`Unknown instruction layout: ${instruction.d8}`);
          continue;
        }

        const txSignature =  block.header.hash;
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

  // At the end of the batch, perform a single, ordered save operation.
  // This replaces all the individual flush() calls.
  const saveStartTime = Date.now();
  // Flush any remaining entities in memory to the database
  await tokenService.flush();
  await curveService.flush();
  await tradeService.flush();
  await globalService.flush();
  performance.databaseSaveTime += Date.now() - saveStartTime;

  // // Log stats
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

  // Calculate and log performance metrics
  const blockTime = Date.now() - blockStartTime;
  performance.totalTime += blockTime;
  performance.blockProcessingTime += blockTime;

  // Log performance metrics periodically
  if (Date.now() - lastLogTime > performance.logInterval) {
    const avgBlockTime = performance.blockProcessingTime / performance.count;
    const throughput = performance.count / ((Date.now() - performance.startTime) / 1000);

    console.log('\n--- PERFORMANCE METRICS ---');
    console.log( ` performance.databaseSaveTime ${performance.databaseSaveTime}`)
    console.log(`Average block processing time: ${avgBlockTime.toFixed(2)}ms`);
    console.log(`Current throughput: ${throughput.toFixed(2)} blocks/second`);
    console.log('---------------------------\n');

    lastLogTime = Date.now();
  }
}



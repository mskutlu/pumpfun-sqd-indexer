import { DataHandlerContext } from "@subsquid/batch-processor"
import { Store } from "@subsquid/typeorm-store"
import { augmentBlock } from "@subsquid/solana-objects"
import { In } from "typeorm"
import { withTimer } from "./utils/timeLogger"

// Import service classes
import { StoreManager } from "./store/memory.store"
import { GlobalService } from "./services/global.service"
import { BondingCurveService } from "./services/bondingCurve.service"
import { TokenService } from "./services/token.service"
import { TradeService } from "./services/trade.service"

// Import models
import { BondingCurve, PumpToken } from "./model"

// Import Pump.fun ABI layouts
import * as pumpIns from "./abi/pump-fun/instructions"
import { PROGRAM_ID } from "./abi/pump-fun"
import * as indexes from "./abi/pump-fun/index"

const instructionLayoutMap = new Map(
  Object.values(pumpIns).map(layout => [layout.d8, layout])
);

/**
 * Collects all entity IDs needed for processing from a batch of blocks
 */
function collectEntityIds(blocks: any[]): { tokenIds: Set<string>, curveIds: Set<string> } {
  const tokenIds = new Set<string>();
  const curveIds = new Set<string>();

  for (const block of blocks) {
    for (const instruction of block.instructions) {
      if (instruction.programId !== PROGRAM_ID) continue;

      try {
        const layout = Object.values(pumpIns).find(i => i.d8 === instruction.d8);
        if (!layout) continue;

        let decoded;
        switch (layout.d8) {
          case pumpIns.create.d8:
            // The create instruction data is in an inner instruction
            const createInner = instruction.inner?.find((f: any) => f.programId === indexes.PROGRAM_ID && f.d8 === pumpIns.createInstruction.d8);
            if (createInner) {
              decoded = pumpIns.createInstruction.decode(createInner);
              if (decoded.data.mint) tokenIds.add(decoded.data.mint.toString());
              if (decoded.data.bondingCurve) curveIds.add(decoded.data.bondingCurve.toString());
            }
            break;

          case pumpIns.withdraw.d8:
            decoded = pumpIns.withdraw.decode(instruction);
            if (decoded.accounts.bondingCurve) curveIds.add(decoded.accounts.bondingCurve.toString());
            break;

          case pumpIns.buy.d8:
          case pumpIns.sell.d8:
            // The trade data is in an inner instruction
            const tradeInner = instruction.inner?.find((f: any) => f.programId === indexes.PROGRAM_ID && f.d8 === pumpIns.tradeEventInstruction.d8);
            if (tradeInner) {
              decoded = pumpIns.tradeEventInstruction.decode(tradeInner);
              if (decoded.data.mint) tokenIds.add(decoded.data.mint.toString());
            }
            // The curve ID is in the outer instruction
            const tradeDecoded = pumpIns.buy.decode(instruction); // buy and sell have same account layout
            if(tradeDecoded.accounts.bondingCurve) curveIds.add(tradeDecoded.accounts.bondingCurve.toString());
            break;
        }
      } catch (e) {
        // Ignore decoding errors during ID collection
      }
    }
  }
  return { tokenIds, curveIds };
}


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

  // Convert blocks once using augmentBlock
  const blocks = ctx.blocks.map(augmentBlock);

  // Collect all entity IDs needed for processing
  // console.log('Collecting entity IDs from batch...');
  const { tokenIds, curveIds } = collectEntityIds(blocks);
  // console.log(`Collected ${tokenIds.size} token IDs and ${curveIds.size} curve IDs`);

  // Bulk prefetch all entities that will be needed during processing
  // console.log('Prefetching entities...');
  const prefetchStartTime = Date.now();
  
  // Prefetch tokens and curves in parallel for better performance
  const [tokens, curves] = await Promise.all([
    tokenIds.size > 0 ? withTimer("db.prefetch.tokens", () => ctx.store.findBy(PumpToken, { id: In([...tokenIds]) })) : [],
    curveIds.size > 0 ? withTimer("db.prefetch.curves", () => ctx.store.findBy(BondingCurve, { id: In([...curveIds]) })) : []
  ]);
  
  // console.log(`Prefetched ${tokens.length} tokens and ${curves.length} curves in ${Date.now() - prefetchStartTime}ms`);

  // Initialize service layer with proper dependencies and prefetched entities
  const storeManager = new StoreManager(ctx, {
    tokens,
    curves
  });
  
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

  stats.processed.blocks = blocks.length;

  // Collect async processing tasks
  const asyncTasks: Promise<void>[] = [];

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
            asyncTasks.push(globalService.processInitializeInstruction(instructionContext, stats));
           
            break;

          case pumpIns.setParams.d8:
            stats.instructions.setParams++;
            asyncTasks.push(globalService.processSetParamsInstruction(instructionContext, stats));
           
            break;

          case pumpIns.create.d8:
            stats.instructions.create++;
            asyncTasks.push(tokenService.processCreateInstruction(instructionContext, stats));
           
            break;

          case pumpIns.withdraw.d8:
            stats.instructions.withdraw++;
            asyncTasks.push(curveService.processWithdrawInstruction(instructionContext, stats));
           
            break;

          case pumpIns.buy.d8:
          case pumpIns.sell.d8:
            stats.instructions.trade++;
            asyncTasks.push(tradeService.processTradeInstruction(instructionContext, stats));
           
            break;

          default:
            stats.instructions.unknown++;
        }
      } catch (error) {
        console.error(`Error processing instruction:`, error);
      }
    }
  }

  // Wait for all async tasks to finish before we perform DB flushes
  await Promise.all(asyncTasks);

  // At the end of the batch, perform a single, ordered save operation.
  // This replaces all the individual flush() calls.
  const saveStartTime = Date.now();
  // Flush any remaining entities in memory to the database
  await tokenService.flush();
  await curveService.flush();
  await tradeService.flush();
  await globalService.flush();
  const databaseSaveTime = Date.now() - saveStartTime;

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



    const avgBlockTime = blockTime / blocks.length;
    const throughput = blocks.length / (blockTime / 1000);

    // console.log('\n--- PERFORMANCE METRICS ---');
    // console.log( ` performance.databaseSaveTime ${databaseSaveTime}`)
    // console.log(`Average block processing time: ${avgBlockTime.toFixed(2)}ms`);
    // console.log(`Current throughput: ${throughput.toFixed(2)} blocks/second`);
    // console.log('---------------------------\n');


}



import { DataHandlerContext } from "@subsquid/batch-processor"
import { TypeormDatabaseWithCache, StoreWithCache } from '@belopash/typeorm-store'
import { augmentBlock } from "@subsquid/solana-objects"

// Import service classes
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


type Task = () => Promise<void>
type ProcessorContext = DataHandlerContext<any, StoreWithCache> & { queue: Task[] }

/**
 * Batch handler passed to Subsquid `run()`.
 */
export async function handle(ctx: DataHandlerContext<any, StoreWithCache>) {
  console.log('==== PROCESSOR STARTING ====');
  
  // Set up the processor context with a task queue
  const processorContext: ProcessorContext = {
    ...ctx,
    queue: []
  };
  
  // Create services with direct StoreWithCache reference
  const globalService = new GlobalService(processorContext.store);
  
  // TokenService needs CurveService but CurveService also needs TokenService
  // We'll create them separately and then set dependencies
  const curveService = new BondingCurveService(processorContext.store);
  const tokenService = new TokenService(processorContext.store, curveService, globalService);
  
  // Now that we have TokenService, we can set it in CurveService
  Object.defineProperty(curveService, 'tokenService', {
    value: tokenService,
    writable: false
  });
  
  // Trade service needs both TokenService and CurveService
  const tradeService = new TradeService(processorContext.store, tokenService, curveService)
  
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
  
  // Process blocks with failure isolation
  // We process one block at a time to prevent one block's errors from affecting others
  for (const block of blocks) {
    try {
      const timestamp = new Date(block.header.timestamp);
      const slot = block.header.slot;
      
      // Group instructions by transaction signature to handle them together
      const instructionsByTx = new Map<string, Array<typeof block.instructions[0]>>();
      
      // First pass - organize instructions by transaction
      for (const instruction of block.instructions) {
        // Skip non-PumpFun instructions
        if (instruction.programId !== PROGRAM_ID) continue;
        stats.processed.instructions++;
        
        const txSignature = instruction.transaction?.signatures?.[0] || 'unknown';
        if (!instructionsByTx.has(txSignature)) {
          instructionsByTx.set(txSignature, []);
        }
        instructionsByTx.get(txSignature)!.push(instruction);
      }
      
      // Second pass - process each transaction's instructions together
      for (const [txSignature, instructions] of instructionsByTx.entries()) {
        try {
          for (const instruction of instructions) {
            try {
              // Identify which instruction layout we have
              const layout = Object.values(pumpIns).find(i => i.d8 === instruction.d8);
              if (!layout) {
                stats.instructions.unknown++;
                continue;
              }
              
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
            } catch (instructionError) {
              console.warn(`Error processing instruction in tx ${txSignature}:`, instructionError);
              // Continue with next instruction - don't let one instruction's failure affect others
            }
          }
        } catch (txError) {
          console.warn(`Error processing transaction ${txSignature}:`, txError);
          // Continue with next transaction - don't let one transaction's failure affect others
        }
      }
    } catch (blockError) {
      console.warn(`Error processing block ${block.header.slot}:`, blockError);
      // Continue with next block - don't let one block's failure affect others
    }
  }

  // Execute all queued tasks
  for (const task of processorContext.queue) {
    await task();
  }
  
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



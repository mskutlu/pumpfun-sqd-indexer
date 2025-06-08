import {run} from '@subsquid/batch-processor'
import {DataSourceBuilder, SolanaRpcClient} from '@subsquid/solana-stream'
import {TypeormDatabase} from '@subsquid/typeorm-store'
import {initialize, setParams, create, buy, sell, withdraw, tradeEventInstruction} from './abi/pump-fun/instructions'
import {PROGRAM_ID, EVENT_AUTHORITY} from './abi/pump-fun/index'
import { handle } from './processor'

// First we create a DataSource - component,
// that defines where to get the data and what data should we get.
const dataSource = new DataSourceBuilder()
    // Provide Subsquid Network Gateway URL.
    .setGateway('https://v2.archive.subsquid.io/network/solana-mainnet')
    // Subsquid Network is always about 1000 blocks behind the head.
    // We must use regular RPC endpoint to get through the last mile
    // and stay on top of the chain.
    // This is a limitation, and we promise to lift it in the future!
    .setRpc(process.env.SOLANA_NODE == null ? undefined : {
        client: new SolanaRpcClient({
            url: process.env.SOLANA_NODE,
            rateLimit: 1 // requests per sec
        }),
        strideConcurrency: 1
    })
    // Set start position to the earliest available block in the dataset
    .setBlockRange({ from: 299804550 })
    .setFields({
        block: { 
            timestamp: true,
            slot: true
        },
        transaction: { 
            signatures: true
        },
        instruction: { 
            programId: true,
            accounts: true,
            data: true
        }
    })
    .addInstruction({
        where: {
            programId: [PROGRAM_ID.toString()],
            d8: [
                initialize.d8,
                setParams.d8,
                create.d8,
                buy.d8,
                sell.d8,
                withdraw.d8
            ],            
            isCommitted: true
        },
        include: {
            innerInstructions: true, 
            transaction: true, 
            transactionTokenBalances: false
        }
    }).build()

// Define the database
const database = new TypeormDatabase({})
run(dataSource, database, handle)


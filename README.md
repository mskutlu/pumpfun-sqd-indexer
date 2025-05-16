# Pump.fun Indexer

This project is a Solana indexer for the Pump.fun protocol using the Subsquid SDK. It tracks and indexes Pump.fun token creations, trades (buys/sells), withdrawals, and global parameter changes.

## About Pump.fun

Pump.fun is a token bonding curve protocol on Solana that allows users to create and trade tokens with automated market making. The protocol uses bonding curves to determine token prices based on supply.

## Project Features

* Indexes all Pump.fun protocol transactions from Solana blockchain
* Tracks token creations, trades, and withdrawals
* Maintains bonding curve state including virtual and real reserves
* Stores historical trading data for analytics
* Built with Subsquid SDK for efficient Solana data processing

## Data Model

The project indexes the following entities:

* **PumpToken** - Information about tokens created on Pump.fun
* **BondingCurve** - The bonding curve parameters and state for each token
* **Trade** - All buy/sell transactions with price and volume data
* **TokenCreated** - Events when new tokens are created
* **TokenCompleted** - Events when tokens are completed/withdrawn
* **GlobalConfig** - Protocol-wide parameters and settings

## Getting Started

### Prerequisites

* Node.js (version 20.x and above)
* Docker

### Run Indexer

```bash
# Install dependencies
npm i

# Compile the project
npx tsc

# Launch Postgres database to store the data
docker compose up -d

# Apply database migrations to create the target schema
npx squid-typeorm-migration apply

# Run indexer
node -r dotenv/config lib/main.js
```

### Querying Indexed Data

After running the indexer, you can query the indexed data using PostgreSQL:

```bash
# Example query to view recent trades
docker exec "$(basename "$(pwd)")-db-1" psql -U postgres \
  -c "SELECT token_id, user, is_buy, sol_amount, token_amount, timestamp FROM trade ORDER BY timestamp DESC LIMIT 10"

# Example query to view tokens
docker exec "$(basename "$(pwd)")-db-1" psql -U postgres \
  -c "SELECT id, name, symbol, creator, status FROM pump_token LIMIT 10"
```

## Architecture

The indexer uses a service-oriented architecture:

* **GlobalService** - Handles protocol initialization and parameter updates
* **TokenService** - Manages token creation and metadata
* **BondingCurveService** - Tracks bonding curve state and withdrawals
* **TradeService** - Processes buy/sell trades

The data source is configured in [main.ts](./src/main.ts) and instruction processing is handled in [processor.ts](./src/processor.ts).

## Solana ABI Handling

The project uses `@subsquid/borsh` for efficient binary data decoding. Instruction layouts and account structures are defined in the [abi](./src/abi) directory.

## Subsquid SDK

This project leverages Subsquid SDK, a TypeScript ETL toolkit for blockchain data that offers:

* Fast binary data codecs with type-safe access to decoded data
* Native support for sourcing data from Subsquid Network
* Efficient batch processing of blockchain data

For more information, see [Solana Indexing Docs](https://docs.subsquid.io/solana-indexing/)

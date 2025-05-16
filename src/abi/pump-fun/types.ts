import {Codec, struct, u64, u8, bool, address} from '@subsquid/borsh'

/**
 * PumpFun Protocol Types
 */

// ------------------- Event Types -------------------

export interface CreateEvent {
  name: string
  symbol: string
  uri: string
  mint: string
  bondingCurve: string
  user: string
}

export const CreateEvent: Codec<CreateEvent> = struct({
  name: address,
  symbol: address,
  uri: address,
  mint: address,
  bondingCurve: address,
  user: address
})

export interface TradeEvent {
  mint: string
  solAmount: bigint
  tokenAmount: bigint
  isBuy: boolean
  user: string
  timestamp: bigint
  virtualSolReserves: bigint
  virtualTokenReserves: bigint
  realSolReserves: bigint
  realTokenReserves: bigint
}

export const TradeEvent: Codec<TradeEvent> = struct({
  mint: address,
  solAmount: u64,
  tokenAmount: u64,
  isBuy: bool,
  user: address,
  timestamp: u64,
  virtualSolReserves: u64,
  virtualTokenReserves: u64,
  realSolReserves: u64,
  realTokenReserves: u64
})

export interface CompleteEvent {
  user: string
  mint: string
  bondingCurve: string
  timestamp: bigint
}

export const CompleteEvent: Codec<CompleteEvent> = struct({
  user: address,
  mint: address,
  bondingCurve: address,
  timestamp: u64
})

export interface SetParamsEvent {
  feeRecipient: string
  initialVirtualTokenReserves: bigint
  initialVirtualSolReserves: bigint
  initialRealTokenReserves: bigint
  tokenTotalSupply: bigint
  feeBasisPoints: bigint
}

export const SetParamsEvent: Codec<SetParamsEvent> = struct({
  feeRecipient: address,
  initialVirtualTokenReserves: u64,
  initialVirtualSolReserves: u64,
  initialRealTokenReserves: u64,
  tokenTotalSupply: u64,
  feeBasisPoints: u64
})

// ------------------- Instruction Args Types -------------------

export interface SetParamsArgs {
  feeRecipient: string
  initialVirtualTokenReserves: bigint
  initialVirtualSolReserves: bigint
  initialRealTokenReserves: bigint
  tokenTotalSupply: bigint
  feeBasisPoints: bigint
}

export const SetParamsArgs: Codec<SetParamsArgs> = struct({
  feeRecipient: address,
  initialVirtualTokenReserves: u64,
  initialVirtualSolReserves: u64,
  initialRealTokenReserves: u64,
  tokenTotalSupply: u64,
  feeBasisPoints: u64
})

export interface CreateArgs {
  name: string
  symbol: string
  uri: string
  creator: string
}

export const CreateArgs: Codec<CreateArgs> = struct({
  name: address,
  symbol: address,
  uri: address,
  creator: address
})

export interface BuyArgs {
  amount: bigint
  maxSolCost: bigint
}

export const BuyArgs: Codec<BuyArgs> = struct({
  amount: u64,
  maxSolCost: u64
})

export interface SellArgs {
  amount: bigint
  minSolOutput: bigint
}

export const SellArgs: Codec<SellArgs> = struct({
  amount: u64,
  minSolOutput: u64
})

// ------------------- Account Data Types -------------------

export interface Global {
  initialized: boolean
  authority: string
  feeRecipient: string
  initialVirtualTokenReserves: bigint
  initialVirtualSolReserves: bigint
  initialRealTokenReserves: bigint
  tokenTotalSupply: bigint
  feeBasisPoints: bigint
}

export const Global: Codec<Global> = struct({
  initialized: bool,
  authority: address,
  feeRecipient: address,
  initialVirtualTokenReserves: u64,
  initialVirtualSolReserves: u64,
  initialRealTokenReserves: u64,
  tokenTotalSupply: u64,
  feeBasisPoints: u64
})

export interface BondingCurve {
  virtualTokenReserves: bigint
  virtualSolReserves: bigint
  realTokenReserves: bigint
  realSolReserves: bigint
  tokenTotalSupply: bigint
  complete: boolean
}

export const BondingCurve: Codec<BondingCurve> = struct({
  virtualTokenReserves: u64,
  virtualSolReserves: u64,
  realTokenReserves: u64,
  realSolReserves: u64,
  tokenTotalSupply: u64,
  complete: bool
})

export interface LastWithdraw {
  lastWithdrawTimestamp: bigint
}

export const LastWithdraw: Codec<LastWithdraw> = struct({
  lastWithdrawTimestamp: u64
})

// ------------------- Error Codes -------------------

export enum ErrorCode {
  NotAuthorized = 6000,
  AlreadyInitialized = 6001,
  TooMuchSolRequired = 6002,
  TooLittleSolReceived = 6003,
  MintDoesNotMatchBondingCurve = 6004,
  BondingCurveComplete = 6005,
  BondingCurveNotComplete = 6006,
  NotInitialized = 6007,
  WithdrawTooFrequent = 6008,
}

export const errorMessages: Record<ErrorCode, string> = {
  [ErrorCode.NotAuthorized]: 'The given account is not authorized to execute this instruction.',
  [ErrorCode.AlreadyInitialized]: 'The program is already initialized.',
  [ErrorCode.TooMuchSolRequired]: 'slippage: Too much SOL required to buy the given amount of tokens.',
  [ErrorCode.TooLittleSolReceived]: 'slippage: Too little SOL received to sell the given amount of tokens.',
  [ErrorCode.MintDoesNotMatchBondingCurve]: 'The mint does not match the bonding curve.',
  [ErrorCode.BondingCurveComplete]: 'The bonding curve has completed and liquidity migrated to raydium.',
  [ErrorCode.BondingCurveNotComplete]: 'The bonding curve has not completed.',
  [ErrorCode.NotInitialized]: 'The program is not initialized.',
  [ErrorCode.WithdrawTooFrequent]: 'Withdraw too frequent',
}

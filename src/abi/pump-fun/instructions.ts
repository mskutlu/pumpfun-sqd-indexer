import {address, bool, string, struct, u64, unit} from '@subsquid/borsh'
import { instruction } from '../idl.support'
import { 
  SetParamsArgs,
  CreateArgs,
  BuyArgs,
  SellArgs
} from './types'

/**
 * Creates the global state.
 */
export type Initialize = undefined

/**
 * Creates the global state.
 */
export const initialize = instruction(
  {
    d8: '0xafaf6d1f0d989bed',
  },
  {
    /**
     * Global state PDA
     */
    global: 0,
    /**
     * User account (signer)
     */
    user: 1,
    /**
     * System program
     */
    systemProgram: 2
  },
  unit
)

/**
 * Sets the global state parameters.
 */
export type SetParams = SetParamsArgs

/**
 * Sets the global state parameters.
 */
export const setParams = instruction(
  {
    d8: '0xa51f8635bdb482ff',
  },
  {
    /**
     * Global state PDA
     */
    global: 0,
    /**
     * User account (signer)
     */
    user: 1,
    /**
     * System program
     */
    systemProgram: 2,
    /**
     * Event authority
     */
    eventAuthority: 3,
    /**
     * Program
     */
    program: 4
  },
  unit
)

/**
 * Creates a new coin and bonding curve.
 */
export type Create = CreateArgs

/**
 * Creates a new coin and bonding curve.
 */
export const create = instruction(
  {
    d8: '0x181ec828051c0777',
  },
  {
    /**
     * Mint account (signer)
     */
    mint: 0,
    /**
     * Mint authority PDA
     */
    mintAuthority: 1,
    /**
     * Bonding curve PDA
     */
    bondingCurve: 2,
    /**
     * Associated bonding curve
     */
    associatedBondingCurve: 3,
    /**
     * Global state PDA
     */
    global: 4,
    /**
     * MPL Token Metadata program
     */
    mplTokenMetadata: 5,
    /**
     * Event authority
     */
    eventAuthority: 6,
    /**
     * Program
     */
    program: 7
  },
    struct({
      name: string,
      symbol: string,
      uri:  string,
    })
)

/**
 * Buy tokens from curve.
 */
export type Buy = BuyArgs

/**
 * Buy tokens from curve.
 */
export const buy = instruction(
  {
    d8: '0x66063d1201daebea',
  },
  {
    /**
     * Bonding curve PDA
     */
    bondingCurve: 0,
    /**
     * Fee recipient account
     */
    feeRecipient: 1,
    /**
     * User account (signer)
     */
    user: 2,
    /**
     * User token account
     */
    userTokenAccount: 3,
    /**
     * Mint account
     */
    mint: 4,
    /**
     * Token program
     */
    tokenProgram: 5,
    /**
     * System program
     */
    systemProgram: 6,
    /**
     * Event authority
     */
    eventAuthority: 7,
    /**
     * Program
     */
    program: 8
  },
  unit
)

/**
 * Sell tokens into curve.
 */
export type Sell = SellArgs

/**
 * Sell tokens into curve.
 */
export const sell = instruction(
  {
    d8: '0x33e685a4017f83ad',
  },
  {
    /**
     * Global state PDA
     */
    global: 0,
    /**
     * Fee recipient account
     */
    feeRecipient: 1,

    /**
     * Mint account
     */
    mint: 2,
    /**
     * Bonding curve PDA
     */
    bondingCurve: 3,
    /**
     * Associated bonding curve
     */
    associatedBondingCurve: 4,

    /**
     * Associated user account
     */
    associatedUser: 5,
    /**
     * User account (signer)
     */
    user: 6,
    /**
     * System program
     */
    systemProgram: 7,
    /**
     * User token account
     */
    userTokenAccount: 8,
    /**
     * Token program
     */
    associatedTokenProgram: 9,
    
    /**
     * Event authority
     */
    eventAuthority: 10,
    /**
     * Program
     */
    program: 11
  },
  struct({
    amount: u64,
    minSolOutput: u64,
  })
)

/**
 * Admin withdraw once curve complete.
 */
export type Withdraw = undefined

/**
 * Admin withdraw once curve complete.
 */
export const withdraw = instruction(
  {
    d8: '0xb712469c946da122',
  },
  {
    /**
     * Last withdraw PDA
     */
    lastWithdraw: 0,
    /**
     * Bonding curve PDA
     */
    bondingCurve: 1,
    /**
     * User account (signer)
     */
    user: 2,
    /**
     * System program
     */
    systemProgram: 3,
    /**
     * Event authority
     */
    eventAuthority: 4,
    /**
     * Program
     */
    program: 5
  },
  unit
)


export const tradeEventInstruction = instruction(
  { d8: '0xe445a52e51cb9a1d' },
  {
    account: 0,
  },
  struct({
    padding0: u64,
    mint: address,
    solAmount: u64,
    tokenAmount: u64,
    isBuy: bool,
    user: address,
    timestamp: u64,
    virtualSolReserves: u64,
    virtualTokenReserves: u64
  })
)


export const createInstruction = instruction(
  { d8: '0xe445a52e51cb9a1d' },
  {
    account: 0,
  },
  struct({
    padding0: u64,
    name: string,
    symbol: string,
    uri: string,
    mint: address,
    bondingCurve: address,
    user: address
  })
)

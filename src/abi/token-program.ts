import {struct, u64, u8} from '@subsquid/borsh'
import {instruction} from './abi.support'


export const instructions = {
	transfer: instruction(
		{
			d1: '0x03',
		},
		{
			source: 0,
			destination: 1,
			signer: 2,
		},
		struct({
			amount: u64
		})
	),
	transferChecked: instruction(
		{
			d1: '0x0c',  
		},
		{
			source: 0,
			mint: 1,
			destination: 2,
			signer: 3,
		},
		struct({
			amount: u64,
			decimals: u8  
		})
	),
}

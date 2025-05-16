import { struct, u64, address } from '@subsquid/borsh'
import { instruction } from './abi.support'

export const instructions = {
    createAccount: instruction(
        // d4 => 4-byte discriminator. For createAccount in the system program,
        // that's 0x00000000 if you're matching "instruction index = 0".
        {
            d4: '0x00000000',
        },
        {
            source: 0,
            newAccount: 1,
        },
        struct({
            lamports: u64,
            space: u64,
            owner: address,
        })
    ),
}

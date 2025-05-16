import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_, BigIntColumn as BigIntColumn_, DateTimeColumn as DateTimeColumn_} from "@subsquid/typeorm-store"
import {PumpToken} from "./pumpToken.model"

@Entity_()
export class BondingCurve {
    constructor(props?: Partial<BondingCurve>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @ManyToOne_(() => PumpToken, {nullable: true})
    token!: PumpToken

    @BigIntColumn_({nullable: false})
    virtualSolReserves!: bigint

    @BigIntColumn_({nullable: false})
    virtualTokenReserves!: bigint

    @BigIntColumn_({nullable: false})
    realSolReserves!: bigint

    @BigIntColumn_({nullable: false})
    realTokenReserves!: bigint

    @BigIntColumn_({nullable: false})
    tokenTotalSupply!: bigint

    @BigIntColumn_({nullable: false})
    feeBasisPoints!: bigint

    @DateTimeColumn_({nullable: false})
    createdAt!: Date

    @DateTimeColumn_({nullable: false})
    updatedAt!: Date
}

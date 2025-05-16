import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_, StringColumn as StringColumn_, BooleanColumn as BooleanColumn_, BigIntColumn as BigIntColumn_, IntColumn as IntColumn_, DateTimeColumn as DateTimeColumn_} from "@subsquid/typeorm-store"
import {PumpToken} from "./pumpToken.model"

@Entity_()
export class Trade {
    constructor(props?: Partial<Trade>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @ManyToOne_(() => PumpToken, {nullable: true})
    token!: PumpToken

    @StringColumn_({nullable: false})
    user!: string

    @BooleanColumn_({nullable: false})
    isBuy!: boolean

    @BigIntColumn_({nullable: false})
    solAmount!: bigint

    @BigIntColumn_({nullable: false})
    tokenAmount!: bigint

    @BigIntColumn_({nullable: false})
    virtualSolReserves!: bigint

    @BigIntColumn_({nullable: false})
    virtualTokenReserves!: bigint

    @BigIntColumn_({nullable: false})
    realSolReserves!: bigint

    @BigIntColumn_({nullable: false})
    realTokenReserves!: bigint

    @IntColumn_({nullable: false})
    slot!: number

    @DateTimeColumn_({nullable: false})
    timestamp!: Date
}

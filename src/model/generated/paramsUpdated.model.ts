import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_, StringColumn as StringColumn_, BigIntColumn as BigIntColumn_, IntColumn as IntColumn_, DateTimeColumn as DateTimeColumn_} from "@subsquid/typeorm-store"
import {PumpToken} from "./pumpToken.model"

@Entity_()
export class ParamsUpdated {
    constructor(props?: Partial<ParamsUpdated>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @Index_()
    @ManyToOne_(() => PumpToken, {nullable: true})
    token!: PumpToken

    @StringColumn_({nullable: false})
    feeRecipient!: string

    @BigIntColumn_({nullable: false})
    feeBasisPoints!: bigint

    @IntColumn_({nullable: false})
    slot!: number

    @DateTimeColumn_({nullable: false})
    timestamp!: Date
}

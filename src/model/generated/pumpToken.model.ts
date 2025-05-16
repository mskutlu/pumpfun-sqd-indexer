import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, StringColumn as StringColumn_, IntColumn as IntColumn_, ManyToOne as ManyToOne_, Index as Index_, DateTimeColumn as DateTimeColumn_} from "@subsquid/typeorm-store"
import {BondingCurve} from "./bondingCurve.model"

@Entity_()
export class PumpToken {
    constructor(props?: Partial<PumpToken>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @StringColumn_({nullable: false})
    name!: string

    @StringColumn_({nullable: false})
    symbol!: string

    @IntColumn_({nullable: false})
    decimals!: number

    @StringColumn_({nullable: false})
    creator!: string

    @Index_()
    @ManyToOne_(() => BondingCurve, {nullable: true})
    bondingCurve!: BondingCurve

    @StringColumn_({nullable: false})
    status!: string

    @DateTimeColumn_({nullable: false})
    createdAt!: Date

    @DateTimeColumn_({nullable: false})
    updatedAt!: Date
}

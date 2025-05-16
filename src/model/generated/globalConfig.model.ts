import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, StringColumn as StringColumn_, BigIntColumn as BigIntColumn_, DateTimeColumn as DateTimeColumn_} from "@subsquid/typeorm-store"

@Entity_()
export class GlobalConfig {
    constructor(props?: Partial<GlobalConfig>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @StringColumn_({nullable: false})
    feeRecipient!: string

    @BigIntColumn_({nullable: false})
    feeBasisPoints!: bigint

    @DateTimeColumn_({nullable: false})
    createdAt!: Date

    @DateTimeColumn_({nullable: false})
    updatedAt!: Date
}

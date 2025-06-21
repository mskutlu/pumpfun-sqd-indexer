import {BigDecimal} from "@subsquid/big-decimal"
import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, BigDecimalColumn as BigDecimalColumn_, BigIntColumn as BigIntColumn_, DateTimeColumn as DateTimeColumn_} from "@subsquid/typeorm-store"

@Entity_()
export class WalletStats {
    constructor(props?: Partial<WalletStats>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @BigDecimalColumn_({nullable: false})
    volumeSol!: BigDecimal

    @BigDecimalColumn_({nullable: false})
    realisedPnlSol!: BigDecimal

    @BigDecimalColumn_({nullable: false})
    buySol!: BigDecimal

    @BigDecimalColumn_({nullable: false})
    sellSol!: BigDecimal

    @BigIntColumn_({nullable: false})
    successTokensCount!: bigint

    @BigIntColumn_({nullable: false})
    tokenCount!: bigint

    @DateTimeColumn_({nullable: false})
    lastTradeTs!: Date
}

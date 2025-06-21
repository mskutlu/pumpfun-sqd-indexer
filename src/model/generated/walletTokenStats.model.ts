import {BigDecimal} from "@subsquid/big-decimal"
import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, StringColumn as StringColumn_, ManyToOne as ManyToOne_, Index as Index_, BigDecimalColumn as BigDecimalColumn_, DateTimeColumn as DateTimeColumn_} from "@subsquid/typeorm-store"
import {PumpToken} from "./pumpToken.model"

@Entity_()
export class WalletTokenStats {
    constructor(props?: Partial<WalletTokenStats>) {
        Object.assign(this, props)
    }

    @PrimaryColumn_()
    id!: string

    @StringColumn_({nullable: false})
    wallet!: string

    @Index_()
    @ManyToOne_(() => PumpToken, {nullable: true})
    token!: PumpToken

    @BigDecimalColumn_({nullable: false})
    volumeSol!: BigDecimal

    @BigDecimalColumn_({nullable: false})
    realisedPnlSol!: BigDecimal

    @BigDecimalColumn_({nullable: false})
    buySol!: BigDecimal

    @BigDecimalColumn_({nullable: false})
    sellSol!: BigDecimal

    @DateTimeColumn_({nullable: false})
    firstTradeTs!: Date

    @DateTimeColumn_({nullable: false})
    lastTradeTs!: Date

    @BigDecimalColumn_({nullable: false})
    firstTradeSol!: BigDecimal

    @BigDecimalColumn_({nullable: false})
    lastTradeSol!: BigDecimal
}

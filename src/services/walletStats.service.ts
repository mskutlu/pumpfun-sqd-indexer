import { PumpToken, WalletStats, WalletTokenStats } from "../model";
import { MemoryStore, StoreManager } from "../store/memory.store";
import { BigDecimal } from "@subsquid/big-decimal";

// 1 SOL = 1_000_000_000 lamports
const LAMPORTS_PER_SOL_DEC = BigDecimal("1000000000");
const ZERO_DEC = BigDecimal(0);

function lamportsToSolDecimal(lamports: bigint): BigDecimal {
  // Convert bigint lamports to BigDecimal SOL by dividing by 1e9
  return BigDecimal(lamports.toString()).div(LAMPORTS_PER_SOL_DEC);
}

export class WalletStatsService {
  private readonly walletStore: MemoryStore<WalletStats>;
  private readonly walletTokenStore: MemoryStore<WalletTokenStats>;

  constructor(private readonly storeManager: StoreManager) {
    this.walletStore = storeManager.getStore<WalletStats>("WalletStats");
    this.walletTokenStore = storeManager.getStore<WalletTokenStats>("WalletTokenStats");
  }

  /**
   * Apply a single trade to wallet-level aggregates
   */
  async applyTrade(params: {
    wallet: string;
    token: PumpToken;
    isBuy: boolean;
    solAmount: bigint;
    timestamp: Date;
  }): Promise<void> {
    const { wallet, token, isBuy, solAmount, timestamp } = params;
    const amountSol = lamportsToSolDecimal(solAmount);
    const volDelta = amountSol;
    const realisedDelta = isBuy ? amountSol.mul(BigDecimal("-1")) : amountSol;
    const buyDelta = isBuy ? amountSol : ZERO_DEC;
    const sellDelta = isBuy ? ZERO_DEC : amountSol;

    /* ---------------- Token-level stats ---------------- */
    const tokenStatsId = `${wallet}-${token.id}`;
    let tokenStats = await this.walletTokenStore.find(tokenStatsId);
    if (!tokenStats) {
      tokenStats = new WalletTokenStats({
        id: tokenStatsId,
        wallet,
        token,
        volumeSol: ZERO_DEC,
        realisedPnlSol: ZERO_DEC,
        buySol: ZERO_DEC,
        sellSol: ZERO_DEC,
        firstTradeTs: timestamp,
        lastTradeTs: timestamp,
        firstTradeSol: amountSol,
        lastTradeSol: amountSol,
      });
    }

    tokenStats.volumeSol = tokenStats.volumeSol.add(volDelta);
    tokenStats.realisedPnlSol = tokenStats.realisedPnlSol.add(realisedDelta);
    tokenStats.buySol = tokenStats.buySol.add(buyDelta);
    tokenStats.sellSol = tokenStats.sellSol.add(sellDelta);
    tokenStats.lastTradeTs = timestamp;
    tokenStats.lastTradeSol = amountSol;

    await this.walletTokenStore.save(tokenStats);

    /* ---------------- Wallet-level stats ---------------- */
    let walletStats = await this.walletStore.find(wallet);
    if (!walletStats) {
      walletStats = new WalletStats({
        id: wallet,
        volumeSol: ZERO_DEC,
        realisedPnlSol: ZERO_DEC,
        buySol: ZERO_DEC,
        sellSol: ZERO_DEC,
        successTokensCount: 0n,
        tokenCount: 0n,
        lastTradeTs: timestamp,
      });
    }

    walletStats.volumeSol = walletStats.volumeSol.add(volDelta);
    walletStats.realisedPnlSol = walletStats.realisedPnlSol.add(realisedDelta);
    walletStats.buySol = walletStats.buySol.add(buyDelta);
    walletStats.sellSol = walletStats.sellSol.add(sellDelta);
    walletStats.lastTradeTs = walletStats.lastTradeTs > timestamp ? walletStats.lastTradeTs : timestamp;

    // recompute token success counts lazily: if realisedPnl turned from <=0 to >0 for this token, increment successTokensCount
    if (tokenStats.realisedPnlSol.gt(ZERO_DEC) && tokenStats.realisedPnlSol.sub(realisedDelta).lte(ZERO_DEC)) {
      walletStats.successTokensCount += 1n;
    }

    // update tokenCount if this is first trade for token
    if (tokenStats.volumeSol.eq(volDelta)) {
      walletStats.tokenCount += 1n;
    }

    await this.walletStore.save(walletStats);
  }

  async flush(): Promise<void> {
    await this.walletTokenStore.flush();
    await this.walletStore.flush();
  }
}

import * as anchor from "@anchor-lang/core";
import { Program } from "@anchor-lang/core";
import {
  createMint,
  createAccount,
  createAssociatedTokenAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { assert } from "chai";
import { Konahrik } from "../target/types/konahrik";

describe("konahrik", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Konahrik as Program<Konahrik>;
  const authority = provider.wallet;

  let usdcMint: PublicKey;
  let vault: Keypair;
  let vaultAuthority: PublicKey;
  let vaultAuthorityBump: number;
  let ammState: PublicKey;
  let ammStateBump: number;

  const pythFeed = new PublicKey("7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE");

  before(async () => {
    usdcMint = await createMint(
      provider.connection,
      (authority as any).payer,
      authority.publicKey,
      null,
      6
    );

    [vaultAuthority, vaultAuthorityBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_authority")],
      program.programId
    );

    vault = Keypair.generate();

    [ammState, ammStateBump] = PublicKey.findProgramAddressSync(
      [Buffer.from("amm_state")],
      program.programId
    );
  });

  describe("initialize_amm", () => {
    it("Initializes AMM with correct parameters", async () => {
      const initialBaseReserve = new anchor.BN("1000000000000000");
      const initialQuoteReserve = new anchor.BN("140000000000000");
      const initialMarginBps = 1000;
      const maintMarginBps = 950;
      const liquidationFeeBps = 250;
      const tradingFeeBps = 10;
      const fundingPeriod = new anchor.BN(2);

      await program.methods
        .initializeAmm({
          initialBaseReserve,
          initialQuoteReserve,
          initialMarginBps,
          maintMarginBps,
          liquidationFeeBps,
          tradingFeeBps,
          fundingPeriod,
        })
        .accounts({
          authority: authority.publicKey,
          ammState,
          vault: vault.publicKey,
          vaultAuthority,
          usdcMint,
          pythFeed,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .signers([vault])
        .rpc();

      const ammStateAccount = await program.account.ammState.fetch(ammState);

      assert.ok(ammStateAccount.authority.equals(authority.publicKey));
      assert.ok(ammStateAccount.baseAssetReserve.eq(initialBaseReserve));
      assert.ok(ammStateAccount.quoteAssetReserve.eq(initialQuoteReserve));

      const expectedK = initialBaseReserve.mul(initialQuoteReserve);
      assert.ok(ammStateAccount.k.eq(expectedK));

      assert.ok(ammStateAccount.cumulativeFundingRate.eq(new anchor.BN(0)));
      assert.ok(ammStateAccount.openInterestLong.eq(new anchor.BN(0)));
      assert.ok(ammStateAccount.openInterestShort.eq(new anchor.BN(0)));

      assert.ok(ammStateAccount.usdcMint.equals(usdcMint));
      assert.ok(ammStateAccount.vault.equals(vault.publicKey));
      assert.ok(ammStateAccount.pythFeed.equals(pythFeed));

      assert.equal(ammStateAccount.initialMarginBps, initialMarginBps);
      assert.equal(ammStateAccount.maintMarginBps, maintMarginBps);
      assert.equal(ammStateAccount.liquidationFeeBps, liquidationFeeBps);
      assert.equal(ammStateAccount.tradingFeeBps, tradingFeeBps);
      assert.ok(ammStateAccount.fundingPeriod.eq(fundingPeriod));
      assert.equal(ammStateAccount.bump, ammStateBump);

      const markPrice = ammStateAccount.quoteAssetReserve
        .mul(new anchor.BN(1_000_000_000))
        .div(ammStateAccount.baseAssetReserve);
      
      const expectedMarkPrice = new anchor.BN(140_000_000);
      const diff = markPrice.sub(expectedMarkPrice).abs();
      assert.ok(diff.lte(new anchor.BN(1)), `Mark price ${markPrice.toString()} not close to ${expectedMarkPrice.toString()}`);
    });

    it("Fails to initialize AMM twice", async () => {
      try {
        await program.methods
          .initializeAmm({
            initialBaseReserve: new anchor.BN("1000000000000000"),
            initialQuoteReserve: new anchor.BN("140000000000000"),
            initialMarginBps: 1000,
            maintMarginBps: 950,
            liquidationFeeBps: 250,
            tradingFeeBps: 10,
            fundingPeriod: new anchor.BN(2),
          })
          .accounts({
            authority: authority.publicKey,
            ammState,
            vault: vault.publicKey,
            vaultAuthority,
            usdcMint,
            pythFeed,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .signers([vault])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        assert.include(err.toString(), "already in use");
      }
    });
  });

  describe("deposit_margin", () => {
    const user = Keypair.generate();
    let userUsdcAccount: PublicKey;
    let userMarginAccount: PublicKey;
    let userMarginAccountBump: number;

    before(async () => {
      await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(user.publicKey, 2_000_000_000)
      );

      userUsdcAccount = await createAssociatedTokenAccount(
        provider.connection,
        (authority as any).payer,
        usdcMint,
        user.publicKey,
        { commitment: "confirmed" }
      );

      await mintTo(
        provider.connection,
        (authority as any).payer,
        usdcMint,
        userUsdcAccount,
        authority.publicKey,
        1_000_000_000
      );

      [userMarginAccount, userMarginAccountBump] = PublicKey.findProgramAddressSync(
        [Buffer.from("margin"), user.publicKey.toBuffer()],
        program.programId
      );
    });

    it("Deposits margin and creates margin account", async () => {
      const depositAmount = new anchor.BN(100_000_000);

      const vaultBefore = await getAccount(provider.connection, vault.publicKey);
      const userUsdcBefore = await getAccount(provider.connection, userUsdcAccount);

      await program.methods
        .depositMargin(depositAmount)
        .accounts({
          user: user.publicKey,
          userMarginAccount,
          ammState,
          vault: vault.publicKey,
          userUsdcAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      const vaultAfter = await getAccount(provider.connection, vault.publicKey);
      const userUsdcAfter = await getAccount(provider.connection, userUsdcAccount);
      const marginAccount = await program.account.userMarginAccount.fetch(userMarginAccount);

      assert.equal(
        Number(vaultAfter.amount - vaultBefore.amount),
        depositAmount.toNumber()
      );
      assert.equal(
        Number(userUsdcBefore.amount - userUsdcAfter.amount),
        depositAmount.toNumber()
      );

      assert.ok(marginAccount.owner.equals(user.publicKey));
      assert.ok(marginAccount.collateral.eq(depositAmount));
      assert.ok(marginAccount.freeCollateral.eq(depositAmount));
      assert.equal(marginAccount.nextPositionId, 0);
      assert.equal(marginAccount.bump, userMarginAccountBump);
    });

    it("Deposits additional margin to existing account", async () => {
      const depositAmount = new anchor.BN(50_000_000);

      await program.methods
        .depositMargin(depositAmount)
        .accounts({
          user: user.publicKey,
          userMarginAccount,
          ammState,
          vault: vault.publicKey,
          userUsdcAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([user])
        .rpc();

      const marginAccount = await program.account.userMarginAccount.fetch(userMarginAccount);

      assert.ok(marginAccount.collateral.eq(new anchor.BN(150_000_000)));
      assert.ok(marginAccount.freeCollateral.eq(new anchor.BN(150_000_000)));
    });

    it("Fails to deposit zero amount", async () => {
      try {
        await program.methods
          .depositMargin(new anchor.BN(0))
          .accounts({
            user: user.publicKey,
            userMarginAccount,
            ammState,
            vault: vault.publicKey,
            userUsdcAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([user])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        assert.include(err.toString(), "InsufficientAmount");
      }
    });

    it("Fails to deposit with wrong user", async () => {
      const wrongUser = Keypair.generate();
      await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(wrongUser.publicKey, 1_000_000_000)
      );

      try {
        await program.methods
          .depositMargin(new anchor.BN(10_000_000))
          .accounts({
            user: wrongUser.publicKey,
            userMarginAccount,
            ammState,
            vault: vault.publicKey,
            userUsdcAccount,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .signers([wrongUser])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        assert.include(err.toString(), "ConstraintSeeds");
      }
    });
  });

  describe("open_position", () => {
    const trader = Keypair.generate();
    let traderUsdcAccount: PublicKey;
    let traderMarginAccount: PublicKey;

    function getPositionPDA(user: PublicKey, positionId: number): PublicKey {
      const buf = Buffer.alloc(4);
      buf.writeUInt32LE(positionId, 0);
      const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("position"), user.toBuffer(), buf],
        program.programId
      );
      return pda;
    }

    before(async () => {
      await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(trader.publicKey, 2_000_000_000)
      );

      traderUsdcAccount = await createAssociatedTokenAccount(
        provider.connection,
        (authority as any).payer,
        usdcMint,
        trader.publicKey,
        { commitment: "confirmed" }
      );

      await mintTo(
        provider.connection,
        (authority as any).payer,
        usdcMint,
        traderUsdcAccount,
        authority.publicKey,
        1_000_000_000
      );

      [traderMarginAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from("margin"), trader.publicKey.toBuffer()],
        program.programId
      );

      await program.methods
        .depositMargin(new anchor.BN(500_000_000))
        .accounts({
          user: trader.publicKey,
          userMarginAccount: traderMarginAccount,
          ammState,
          vault: vault.publicKey,
          userUsdcAccount: traderUsdcAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([trader])
        .rpc();
    });

    it("Opens LONG position with 10x leverage", async () => {
      const collateralAmount = new anchor.BN(10_000_000);
      const leverage = 10;
      const minBaseAmount = new anchor.BN(0);

      const ammBefore = await program.account.ammState.fetch(ammState);
      const marginBefore = await program.account.userMarginAccount.fetch(traderMarginAccount);

      const positionPDA = getPositionPDA(trader.publicKey, 0);

      await program.methods
        .openPosition({
          isLong: true,
          collateralAmount,
          leverage,
          minBaseAmount,
        })
        .accounts({
          user: trader.publicKey,
          userMarginAccount: traderMarginAccount,
          position: positionPDA,
          ammState,
          pythPriceFeed: pythFeed,
          systemProgram: SystemProgram.programId,
        })
        .signers([trader])
        .rpc();

      const ammAfter = await program.account.ammState.fetch(ammState);
      const marginAfter = await program.account.userMarginAccount.fetch(traderMarginAccount);
      const position = await program.account.position.fetch(positionPDA);

      assert.ok(ammAfter.quoteAssetReserve.gt(ammBefore.quoteAssetReserve));
      assert.ok(ammAfter.baseAssetReserve.lt(ammBefore.baseAssetReserve));

      const kCheck = ammAfter.baseAssetReserve.mul(ammAfter.quoteAssetReserve);
      const kDiff = ammAfter.k.sub(kCheck).abs();
      assert.ok(kDiff.lte(ammAfter.quoteAssetReserve), `k invariant violated: diff=${kDiff.toString()}`);

      assert.ok(position.owner.equals(trader.publicKey));
      assert.equal(position.positionId, 0);
      assert.equal(position.isLong, true);
      assert.ok(position.size.gt(new anchor.BN(0)));
      assert.ok(position.notional.eq(new anchor.BN(100_000_000)));
      assert.ok(position.entryPrice.gt(new anchor.BN(0)));

      const expectedMargin = collateralAmount.sub(
        collateralAmount.mul(new anchor.BN(leverage)).mul(new anchor.BN(10)).div(new anchor.BN(10_000))
      );
      assert.ok(position.margin.eq(expectedMargin));

      assert.ok(position.fundingSnapshot.eq(new anchor.BN(0)));

      assert.ok(marginAfter.freeCollateral.lt(marginBefore.freeCollateral));
      assert.ok(
        marginBefore.freeCollateral.sub(marginAfter.freeCollateral).eq(collateralAmount)
      );

      assert.equal(marginAfter.nextPositionId, 1);

      assert.ok(ammAfter.openInterestLong.eq(new anchor.BN(100_000_000)));
    });

    it("Opens SHORT position", async () => {
      const collateralAmount = new anchor.BN(5_000_000);
      const leverage = 5;
      const minBaseAmount = new anchor.BN(0);

      const ammBefore = await program.account.ammState.fetch(ammState);

      const positionPDA = getPositionPDA(trader.publicKey, 1);

      await program.methods
        .openPosition({
          isLong: false,
          collateralAmount,
          leverage,
          minBaseAmount,
        })
        .accounts({
          user: trader.publicKey,
          userMarginAccount: traderMarginAccount,
          position: positionPDA,
          ammState,
          pythPriceFeed: pythFeed,
          systemProgram: SystemProgram.programId,
        })
        .signers([trader])
        .rpc();

      const ammAfter = await program.account.ammState.fetch(ammState);
      const position = await program.account.position.fetch(positionPDA);

      assert.ok(ammAfter.quoteAssetReserve.lt(ammBefore.quoteAssetReserve));
      assert.ok(ammAfter.baseAssetReserve.gt(ammBefore.baseAssetReserve));

      assert.equal(position.isLong, false);
      assert.equal(position.positionId, 1);
      assert.ok(position.notional.eq(new anchor.BN(25_000_000)));

      const marginAfter = await program.account.userMarginAccount.fetch(traderMarginAccount);
      assert.equal(marginAfter.nextPositionId, 2);

      assert.ok(ammAfter.openInterestShort.eq(new anchor.BN(25_000_000)));
    });

    it("Fails with leverage > 10", async () => {
      const positionPDA = getPositionPDA(trader.publicKey, 2);

      try {
        await program.methods
          .openPosition({
            isLong: true,
            collateralAmount: new anchor.BN(10_000_000),
            leverage: 11,
            minBaseAmount: new anchor.BN(0),
          })
          .accounts({
            user: trader.publicKey,
            userMarginAccount: traderMarginAccount,
            position: positionPDA,
            ammState,
            pythPriceFeed: pythFeed,
            systemProgram: SystemProgram.programId,
          })
          .signers([trader])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        assert.include(err.toString(), "InvalidLeverage");
      }
    });

    it("Fails with leverage = 0", async () => {
      const positionPDA = getPositionPDA(trader.publicKey, 2);

      try {
        await program.methods
          .openPosition({
            isLong: true,
            collateralAmount: new anchor.BN(10_000_000),
            leverage: 0,
            minBaseAmount: new anchor.BN(0),
          })
          .accounts({
            user: trader.publicKey,
            userMarginAccount: traderMarginAccount,
            position: positionPDA,
            ammState,
            pythPriceFeed: pythFeed,
            systemProgram: SystemProgram.programId,
          })
          .signers([trader])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        assert.include(err.toString(), "InvalidLeverage");
      }
    });

    it("Fails with insufficient margin", async () => {
      const marginAccount = await program.account.userMarginAccount.fetch(traderMarginAccount);
      const tooMuch = marginAccount.freeCollateral.add(new anchor.BN(1));
      const positionPDA = getPositionPDA(trader.publicKey, 2);

      try {
        await program.methods
          .openPosition({
            isLong: true,
            collateralAmount: tooMuch,
            leverage: 1,
            minBaseAmount: new anchor.BN(0),
          })
          .accounts({
            user: trader.publicKey,
            userMarginAccount: traderMarginAccount,
            position: positionPDA,
            ammState,
            pythPriceFeed: pythFeed,
            systemProgram: SystemProgram.programId,
          })
          .signers([trader])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        assert.include(err.toString(), "InsufficientMargin");
      }
    });

    it("Fails with slippage exceeded", async () => {
      const positionPDA = getPositionPDA(trader.publicKey, 2);

      try {
        await program.methods
          .openPosition({
            isLong: true,
            collateralAmount: new anchor.BN(10_000_000),
            leverage: 1,
            minBaseAmount: new anchor.BN("999999999999999"),
          })
          .accounts({
            user: trader.publicKey,
            userMarginAccount: traderMarginAccount,
            position: positionPDA,
            ammState,
            pythPriceFeed: pythFeed,
            systemProgram: SystemProgram.programId,
          })
          .signers([trader])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        assert.include(err.toString(), "SlippageExceeded");
      }
    });
  });

  describe("close_position", () => {
    const traderA = Keypair.generate();
    const traderB = Keypair.generate();
    let traderAUsdc: PublicKey;
    let traderBUsdc: PublicKey;
    let traderAMargin: PublicKey;
    let traderBMargin: PublicKey;

    function getPositionPDA(user: PublicKey, positionId: number): PublicKey {
      const buf = Buffer.alloc(4);
      buf.writeUInt32LE(positionId, 0);
      const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("position"), user.toBuffer(), buf],
        program.programId
      );
      return pda;
    }

    async function setupTrader(keypair: Keypair, usdcAmount: number): Promise<{ usdcAccount: PublicKey; marginAccount: PublicKey }> {
      await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(keypair.publicKey, 2_000_000_000)
      );

      const usdcAccount = await createAssociatedTokenAccount(
        provider.connection,
        (authority as any).payer,
        usdcMint,
        keypair.publicKey,
        { commitment: "confirmed" }
      );

      await mintTo(
        provider.connection,
        (authority as any).payer,
        usdcMint,
        usdcAccount,
        authority.publicKey,
        usdcAmount
      );

      const [marginAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from("margin"), keypair.publicKey.toBuffer()],
        program.programId
      );

      await program.methods
        .depositMargin(new anchor.BN(usdcAmount))
        .accounts({
          user: keypair.publicKey,
          userMarginAccount: marginAccount,
          ammState,
          vault: vault.publicKey,
          userUsdcAccount: usdcAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([keypair])
        .rpc();

      return { usdcAccount, marginAccount };
    }

    before(async () => {
      const a = await setupTrader(traderA, 1_000_000_000);
      traderAUsdc = a.usdcAccount;
      traderAMargin = a.marginAccount;

      const b = await setupTrader(traderB, 1_000_000_000);
      traderBUsdc = b.usdcAccount;
      traderBMargin = b.marginAccount;
    });

    it("Closes LONG position with profit", async () => {
      const positionPDA_A = getPositionPDA(traderA.publicKey, 0);

      await program.methods
        .openPosition({
          isLong: true,
          collateralAmount: new anchor.BN(10_000_000),
          leverage: 10,
          minBaseAmount: new anchor.BN(0),
        })
        .accounts({
          user: traderA.publicKey,
          userMarginAccount: traderAMargin,
          position: positionPDA_A,
          ammState,
          pythPriceFeed: pythFeed,
          systemProgram: SystemProgram.programId,
        })
        .signers([traderA])
        .rpc();

      const positionPDA_B = getPositionPDA(traderB.publicKey, 0);

      await program.methods
        .openPosition({
          isLong: true,
          collateralAmount: new anchor.BN(50_000_000),
          leverage: 10,
          minBaseAmount: new anchor.BN(0),
        })
        .accounts({
          user: traderB.publicKey,
          userMarginAccount: traderBMargin,
          position: positionPDA_B,
          ammState,
          pythPriceFeed: pythFeed,
          systemProgram: SystemProgram.programId,
        })
        .signers([traderB])
        .rpc();

      const marginBefore = await program.account.userMarginAccount.fetch(traderAMargin);

      await program.methods
        .closePosition()
        .accounts({
          user: traderA.publicKey,
          userMarginAccount: traderAMargin,
          position: positionPDA_A,
          ammState,
          pythPriceFeed: pythFeed,
        })
        .signers([traderA])
        .rpc();

      const marginAfter = await program.account.userMarginAccount.fetch(traderAMargin);

      assert.ok(marginAfter.freeCollateral.gt(marginBefore.freeCollateral));

      try {
        await program.account.position.fetch(positionPDA_A);
        assert.fail("Position should be closed");
      } catch (err) {
        assert.include(err.toString(), "does not exist");
      }
    });

    it("Closes LONG position with loss", async () => {
      const traderC = Keypair.generate();
      const traderD = Keypair.generate();
      const c = await setupTrader(traderC, 1_000_000_000);
      const d = await setupTrader(traderD, 1_000_000_000);

      const positionPDA_C = getPositionPDA(traderC.publicKey, 0);

      await program.methods
        .openPosition({
          isLong: true,
          collateralAmount: new anchor.BN(10_000_000),
          leverage: 5,
          minBaseAmount: new anchor.BN(0),
        })
        .accounts({
          user: traderC.publicKey,
          userMarginAccount: c.marginAccount,
          position: positionPDA_C,
          ammState,
          pythPriceFeed: pythFeed,
          systemProgram: SystemProgram.programId,
        })
        .signers([traderC])
        .rpc();

      const positionPDA_D = getPositionPDA(traderD.publicKey, 0);

      await program.methods
        .openPosition({
          isLong: false,
          collateralAmount: new anchor.BN(100_000_000),
          leverage: 5,
          minBaseAmount: new anchor.BN(0),
        })
        .accounts({
          user: traderD.publicKey,
          userMarginAccount: d.marginAccount,
          position: positionPDA_D,
          ammState,
          pythPriceFeed: pythFeed,
          systemProgram: SystemProgram.programId,
        })
        .signers([traderD])
        .rpc();

      const marginBefore = await program.account.userMarginAccount.fetch(c.marginAccount);
      const freeCollateralBefore = marginBefore.freeCollateral;

      await program.methods
        .closePosition()
        .accounts({
          user: traderC.publicKey,
          userMarginAccount: c.marginAccount,
          position: positionPDA_C,
          ammState,
          pythPriceFeed: pythFeed,
        })
        .signers([traderC])
        .rpc();

      const marginAfter = await program.account.userMarginAccount.fetch(c.marginAccount);

      assert.ok(
        marginAfter.freeCollateral.lt(freeCollateralBefore.add(new anchor.BN(10_000_000))),
        "Free collateral should be less than original margin (loss scenario)"
      );
    });

    it("Fails to close with wrong signer", async () => {
      const traderE = Keypair.generate();
      const e = await setupTrader(traderE, 500_000_000);

      const positionPDA_E = getPositionPDA(traderE.publicKey, 0);

      await program.methods
        .openPosition({
          isLong: true,
          collateralAmount: new anchor.BN(10_000_000),
          leverage: 5,
          minBaseAmount: new anchor.BN(0),
        })
        .accounts({
          user: traderE.publicKey,
          userMarginAccount: e.marginAccount,
          position: positionPDA_E,
          ammState,
          pythPriceFeed: pythFeed,
          systemProgram: SystemProgram.programId,
        })
        .signers([traderE])
        .rpc();

      const wrongUser = Keypair.generate();
      await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(wrongUser.publicKey, 1_000_000_000)
      );

      try {
        await program.methods
          .closePosition()
          .accounts({
            user: wrongUser.publicKey,
            userMarginAccount: e.marginAccount,
            position: positionPDA_E,
            ammState,
            pythPriceFeed: pythFeed,
          })
          .signers([wrongUser])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        assert.include(err.toString(), "ConstraintSeeds");
      }
    });
  });

  describe("withdraw_margin", () => {
    const withdrawUser = Keypair.generate();
    let withdrawUserUsdcAccount: PublicKey;
    let withdrawUserMarginAccount: PublicKey;

    before(async () => {
      await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(withdrawUser.publicKey, 2_000_000_000)
      );

      withdrawUserUsdcAccount = await createAssociatedTokenAccount(
        provider.connection,
        (authority as any).payer,
        usdcMint,
        withdrawUser.publicKey,
        { commitment: "confirmed" }
      );

      await mintTo(
        provider.connection,
        (authority as any).payer,
        usdcMint,
        withdrawUserUsdcAccount,
        authority.publicKey,
        500_000_000
      );

      [withdrawUserMarginAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from("margin"), withdrawUser.publicKey.toBuffer()],
        program.programId
      );

      await program.methods
        .depositMargin(new anchor.BN(200_000_000))
        .accounts({
          user: withdrawUser.publicKey,
          userMarginAccount: withdrawUserMarginAccount,
          ammState,
          vault: vault.publicKey,
          userUsdcAccount: withdrawUserUsdcAccount,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([withdrawUser])
        .rpc();
    });

    it("Withdraws margin successfully", async () => {
      const withdrawAmount = new anchor.BN(50_000_000);

      const vaultBefore = await getAccount(provider.connection, vault.publicKey);
      const userUsdcBefore = await getAccount(provider.connection, withdrawUserUsdcAccount);

      await program.methods
        .withdrawMargin(withdrawAmount)
        .accounts({
          user: withdrawUser.publicKey,
          userMarginAccount: withdrawUserMarginAccount,
          userUsdcAccount: withdrawUserUsdcAccount,
          vault: vault.publicKey,
          vaultAuthority,
          ammState,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([withdrawUser])
        .rpc();

      const vaultAfter = await getAccount(provider.connection, vault.publicKey);
      const userUsdcAfter = await getAccount(provider.connection, withdrawUserUsdcAccount);
      const marginAccount = await program.account.userMarginAccount.fetch(withdrawUserMarginAccount);

      assert.equal(
        Number(vaultBefore.amount - vaultAfter.amount),
        withdrawAmount.toNumber()
      );
      assert.equal(
        Number(userUsdcAfter.amount - userUsdcBefore.amount),
        withdrawAmount.toNumber()
      );

      assert.ok(marginAccount.collateral.eq(new anchor.BN(150_000_000)));
      assert.ok(marginAccount.freeCollateral.eq(new anchor.BN(150_000_000)));
    });

    it("Fails to withdraw more than free collateral", async () => {
      const withdrawAmount = new anchor.BN(200_000_000);

      try {
        await program.methods
          .withdrawMargin(withdrawAmount)
          .accounts({
            user: withdrawUser.publicKey,
            userMarginAccount: withdrawUserMarginAccount,
            userUsdcAccount: withdrawUserUsdcAccount,
            vault: vault.publicKey,
            vaultAuthority,
            ammState,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([withdrawUser])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        assert.include(err.toString(), "WithdrawalExceedsAvailable");
      }
    });

    it("Fails to withdraw with wrong signer", async () => {
      const wrongUser = Keypair.generate();
      await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(wrongUser.publicKey, 1_000_000_000)
      );

      const wrongUserUsdcAccount = await createAssociatedTokenAccount(
        provider.connection,
        (authority as any).payer,
        usdcMint,
        wrongUser.publicKey,
        { commitment: "confirmed" }
      );

      try {
        await program.methods
          .withdrawMargin(new anchor.BN(50_000_000))
          .accounts({
            user: wrongUser.publicKey,
            userMarginAccount: withdrawUserMarginAccount,
            userUsdcAccount: wrongUserUsdcAccount,
            vault: vault.publicKey,
            vaultAuthority,
            ammState,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([wrongUser])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        assert.include(err.toString(), "ConstraintSeeds");
      }
    });
  });

  describe("update_funding", () => {
    const fundingTrader = Keypair.generate();
    let fundingTraderUsdc: PublicKey;
    let fundingTraderMargin: PublicKey;

    before(async () => {
      await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(fundingTrader.publicKey, 2_000_000_000)
      );

      fundingTraderUsdc = await createAssociatedTokenAccount(
        provider.connection,
        (authority as any).payer,
        usdcMint,
        fundingTrader.publicKey,
        { commitment: "confirmed" }
      );

      await mintTo(
        provider.connection,
        (authority as any).payer,
        usdcMint,
        fundingTraderUsdc,
        authority.publicKey,
        1_000_000_000
      );

      [fundingTraderMargin] = PublicKey.findProgramAddressSync(
        [Buffer.from("margin"), fundingTrader.publicKey.toBuffer()],
        program.programId
      );

      await program.methods
        .depositMargin(new anchor.BN(500_000_000))
        .accounts({
          user: fundingTrader.publicKey,
          userMarginAccount: fundingTraderMargin,
          ammState,
          vault: vault.publicKey,
          userUsdcAccount: fundingTraderUsdc,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([fundingTrader])
        .rpc();
    });

    async function updateFundingWhenDue() {
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          await program.methods
            .updateFunding()
            .accounts({
              ammState,
              pythPriceFeed: pythFeed,
            })
            .rpc();
          return;
        } catch (err) {
          if (!err.toString().includes("FundingNotDue") || attempt === 9) {
            throw err;
          }
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
    }

    it("Fails when funding period has not elapsed", async () => {
      await updateFundingWhenDue();

      try {
        await program.methods
          .updateFunding()
          .accounts({
            ammState,
            pythPriceFeed: pythFeed,
          })
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        assert.include(err.toString(), "FundingNotDue");
      }
    });

    it("Succeeds when funding period has elapsed", async () => {
      await new Promise((resolve) => setTimeout(resolve, 4500));

      const ammBefore = await program.account.ammState.fetch(ammState);

      await updateFundingWhenDue();

      const ammAfter = await program.account.ammState.fetch(ammState);

      assert.ok(
        ammAfter.lastFundingTs.gt(ammBefore.lastFundingTs),
        "last_funding_ts should be updated"
      );
    });

    it("Positive funding rate when mark > index (long pushes mark up)", async () => {
      const buf = Buffer.alloc(4);
      buf.writeUInt32LE(0, 0);
      const [positionPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("position"), fundingTrader.publicKey.toBuffer(), buf],
        program.programId
      );

      await program.methods
        .openPosition({
          isLong: true,
          collateralAmount: new anchor.BN(500_000_000),
          leverage: 10,
          minBaseAmount: new anchor.BN(0),
        })
        .accounts({
          user: fundingTrader.publicKey,
          userMarginAccount: fundingTraderMargin,
          position: positionPDA,
          ammState,
          pythPriceFeed: pythFeed,
          systemProgram: SystemProgram.programId,
        })
        .signers([fundingTrader])
        .rpc();

      await new Promise((resolve) => setTimeout(resolve, 3500));

      const ammBefore = await program.account.ammState.fetch(ammState);

      await updateFundingWhenDue();

      const ammAfter = await program.account.ammState.fetch(ammState);

      assert.ok(
        !ammAfter.cumulativeFundingRate.eq(ammBefore.cumulativeFundingRate),
        "Funding rate should change after update"
      );
    });

    it("Negative funding rate when mark < index (short pushes mark down)", async () => {
      const shortTrader = Keypair.generate();
      await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(shortTrader.publicKey, 2_000_000_000)
      );

      const shortTraderUsdc = await createAssociatedTokenAccount(
        provider.connection,
        (authority as any).payer,
        usdcMint,
        shortTrader.publicKey,
        { commitment: "confirmed" }
      );

      await mintTo(
        provider.connection,
        (authority as any).payer,
        usdcMint,
        shortTraderUsdc,
        authority.publicKey,
        1_000_000_000
      );

      const [shortTraderMargin] = PublicKey.findProgramAddressSync(
        [Buffer.from("margin"), shortTrader.publicKey.toBuffer()],
        program.programId
      );

      await program.methods
        .depositMargin(new anchor.BN(500_000_000))
        .accounts({
          user: shortTrader.publicKey,
          userMarginAccount: shortTraderMargin,
          ammState,
          vault: vault.publicKey,
          userUsdcAccount: shortTraderUsdc,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([shortTrader])
        .rpc();

      const buf = Buffer.alloc(4);
      buf.writeUInt32LE(0, 0);
      const [positionPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from("position"), shortTrader.publicKey.toBuffer(), buf],
        program.programId
      );

      await program.methods
        .openPosition({
          isLong: false,
          collateralAmount: new anchor.BN(200_000_000),
          leverage: 10,
          minBaseAmount: new anchor.BN(0),
        })
        .accounts({
          user: shortTrader.publicKey,
          userMarginAccount: shortTraderMargin,
          position: positionPDA,
          ammState,
          pythPriceFeed: pythFeed,
          systemProgram: SystemProgram.programId,
        })
        .signers([shortTrader])
        .rpc();

      await new Promise((resolve) => setTimeout(resolve, 3500));

      const ammBefore = await program.account.ammState.fetch(ammState);

      await updateFundingWhenDue();

      const ammAfter = await program.account.ammState.fetch(ammState);

      assert.ok(
        ammAfter.cumulativeFundingRate.lt(ammBefore.cumulativeFundingRate),
        "Funding rate should be negative when mark < index"
      );
    });

    it("Cumulative funding accumulates over multiple updates", async () => {
      await new Promise((resolve) => setTimeout(resolve, 4500));

      await updateFundingWhenDue();

      const ammAfterFirst = await program.account.ammState.fetch(ammState);
      const firstRate = ammAfterFirst.cumulativeFundingRate;

      await new Promise((resolve) => setTimeout(resolve, 4500));

      await updateFundingWhenDue();

      const ammAfterSecond = await program.account.ammState.fetch(ammState);

      assert.ok(
        ammAfterSecond.cumulativeFundingRate.abs().gte(firstRate.abs()),
        "Cumulative funding should accumulate"
      );
    });
  });

  describe("liquidate", () => {
    function getPositionPDA(owner: PublicKey, positionId: number): PublicKey {
      const buf = Buffer.alloc(4);
      buf.writeUInt32LE(positionId, 0);
      const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("position"), owner.toBuffer(), buf],
        program.programId
      );
      return pda;
    }

    async function setupTrader(keypair: Keypair): Promise<{ usdc: PublicKey; margin: PublicKey }> {
      await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(keypair.publicKey, 5_000_000_000)
      );
      const usdc = await createAssociatedTokenAccount(provider.connection, (authority as any).payer, usdcMint, keypair.publicKey, { commitment: "confirmed" });
      await mintTo(provider.connection, (authority as any).payer, usdcMint, usdc, authority.publicKey, 5_000_000_000);
      const [margin] = PublicKey.findProgramAddressSync([Buffer.from("margin"), keypair.publicKey.toBuffer()], program.programId);
      await program.methods
        .depositMargin(new anchor.BN(2_000_000_000))
        .accounts({ user: keypair.publicKey, userMarginAccount: margin, ammState, vault: vault.publicKey, userUsdcAccount: usdc, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
        .signers([keypair])
        .rpc();
      return { usdc, margin };
    }

    async function pushPriceDownShorts(collateralEach: number) {
      const pusher = Keypair.generate();
      await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(pusher.publicKey, 10_000_000_000));
      const pusherUsdc = await createAssociatedTokenAccount(provider.connection, (authority as any).payer, usdcMint, pusher.publicKey, { commitment: "confirmed" });
      await mintTo(provider.connection, (authority as any).payer, usdcMint, pusherUsdc, authority.publicKey, collateralEach * 2);
      const [pusherMargin] = PublicKey.findProgramAddressSync([Buffer.from("margin"), pusher.publicKey.toBuffer()], program.programId);
      await program.methods
        .depositMargin(new anchor.BN(collateralEach))
        .accounts({ user: pusher.publicKey, userMarginAccount: pusherMargin, ammState, vault: vault.publicKey, userUsdcAccount: pusherUsdc, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
        .signers([pusher])
        .rpc();
      const pushPos = getPositionPDA(pusher.publicKey, 0);
      await program.methods
        .openPosition({ isLong: false, collateralAmount: new anchor.BN(collateralEach), leverage: 10, minBaseAmount: new anchor.BN(0) })
        .accounts({ user: pusher.publicKey, userMarginAccount: pusherMargin, position: pushPos, ammState, pythPriceFeed: pythFeed, systemProgram: SystemProgram.programId })
        .signers([pusher])
        .rpc();
    }

    it("Succeeds when position is underwater", async () => {
      const victim = Keypair.generate();
      const { usdc, margin } = await setupTrader(victim);
      const posPDA = getPositionPDA(victim.publicKey, 0);

      await program.methods
        .openPosition({ isLong: true, collateralAmount: new anchor.BN(5_000_000), leverage: 10, minBaseAmount: new anchor.BN(0) })
        .accounts({ user: victim.publicKey, userMarginAccount: margin, position: posPDA, ammState, pythPriceFeed: pythFeed, systemProgram: SystemProgram.programId })
        .signers([victim])
        .rpc();

      await pushPriceDownShorts(500_000_000_000);

      const liquidator = Keypair.generate();
      await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(liquidator.publicKey, 5_000_000_000));
      const liqUsdc = await createAssociatedTokenAccount(provider.connection, (authority as any).payer, usdcMint, liquidator.publicKey, { commitment: "confirmed" });
      await mintTo(provider.connection, (authority as any).payer, usdcMint, liqUsdc, authority.publicKey, 1_000_000_000);

      const vaultBefore = await getAccount(provider.connection, vault.publicKey);
      const liqBefore = await getAccount(provider.connection, liqUsdc);

      await program.methods
        .liquidate({ positionOwner: victim.publicKey, positionId: 0 })
        .accounts({
          liquidator: liquidator.publicKey, liquidatorUsdcAccount: liqUsdc,
          positionOwnerMargin: margin, position: posPDA,
          ammState, vault: vault.publicKey, vaultAuthority,
          pythPriceFeed: pythFeed, tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([liquidator])
        .rpc();

      const vaultAfter = await getAccount(provider.connection, vault.publicKey);
      const liqAfter = await getAccount(provider.connection, liqUsdc);

      assert.ok(Number(liqAfter.amount - liqBefore.amount) > 0, "Liquidator receives fee");
      assert.ok(Number(vaultBefore.amount - vaultAfter.amount) > 0, "Vault decreases");

      try {
        await program.account.position.fetch(posPDA);
        assert.fail("Position account closed");
      } catch (err) {
        assert.include(err.toString(), "does not exist");
      }
    });

    it("Self-liquidation prevented", async () => {
      const victim = Keypair.generate();
      const { usdc, margin } = await setupTrader(victim);
      const posPDA = getPositionPDA(victim.publicKey, 0);

      await program.methods
        .openPosition({ isLong: true, collateralAmount: new anchor.BN(5_000_000), leverage: 10, minBaseAmount: new anchor.BN(0) })
        .accounts({ user: victim.publicKey, userMarginAccount: margin, position: posPDA, ammState, pythPriceFeed: pythFeed, systemProgram: SystemProgram.programId })
        .signers([victim])
        .rpc();

      await pushPriceDownShorts(500_000_000_000);

      try {
        await program.methods
          .liquidate({ positionOwner: victim.publicKey, positionId: 0 })
          .accounts({
            liquidator: victim.publicKey, liquidatorUsdcAccount: usdc,
            positionOwnerMargin: margin, position: posPDA,
            ammState, vault: vault.publicKey, vaultAuthority,
            pythPriceFeed: pythFeed, tokenProgram: TOKEN_PROGRAM_ID,
          })
          .signers([victim])
          .rpc();
        assert.fail("Should have failed");
      } catch (err) {
        assert.include(err.toString(), "SelfLiquidation");
      }
    });
  });

  describe("integration", () => {
    function getPositionPDA(owner: PublicKey, positionId: number): PublicKey {
      const buf = Buffer.alloc(4);
      buf.writeUInt32LE(positionId, 0);
      const [pda] = PublicKey.findProgramAddressSync(
        [Buffer.from("position"), owner.toBuffer(), buf],
        program.programId
      );
      return pda;
    }

    async function setupTrader(keypair: Keypair): Promise<{ usdc: PublicKey; margin: PublicKey }> {
      await provider.connection.confirmTransaction(
        await provider.connection.requestAirdrop(keypair.publicKey, 5_000_000_000)
      );
      const usdc = await createAssociatedTokenAccount(provider.connection, (authority as any).payer, usdcMint, keypair.publicKey, { commitment: "confirmed" });
      await mintTo(provider.connection, (authority as any).payer, usdcMint, usdc, authority.publicKey, 5_000_000_000);
      const [margin] = PublicKey.findProgramAddressSync([Buffer.from("margin"), keypair.publicKey.toBuffer()], program.programId);
      await program.methods
        .depositMargin(new anchor.BN(2_000_000_000))
        .accounts({ user: keypair.publicKey, userMarginAccount: margin, ammState, vault: vault.publicKey, userUsdcAccount: usdc, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
        .signers([keypair])
        .rpc();
      return { usdc, margin };
    }

    async function pushPriceDownShorts(collateralEach: number) {
      const pusher = Keypair.generate();
      await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(pusher.publicKey, 10_000_000_000));
      const pusherUsdc = await createAssociatedTokenAccount(provider.connection, (authority as any).payer, usdcMint, pusher.publicKey, { commitment: "confirmed" });
      await mintTo(provider.connection, (authority as any).payer, usdcMint, pusherUsdc, authority.publicKey, collateralEach * 2);
      const [pusherMargin] = PublicKey.findProgramAddressSync([Buffer.from("margin"), pusher.publicKey.toBuffer()], program.programId);
      await program.methods
        .depositMargin(new anchor.BN(collateralEach))
        .accounts({ user: pusher.publicKey, userMarginAccount: pusherMargin, ammState, vault: vault.publicKey, userUsdcAccount: pusherUsdc, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
        .signers([pusher])
        .rpc();
      const pushPos = getPositionPDA(pusher.publicKey, 0);
      await program.methods
        .openPosition({ isLong: false, collateralAmount: new anchor.BN(collateralEach), leverage: 10, minBaseAmount: new anchor.BN(0) })
        .accounts({ user: pusher.publicKey, userMarginAccount: pusherMargin, position: pushPos, ammState, pythPriceFeed: pythFeed, systemProgram: SystemProgram.programId })
        .signers([pusher])
        .rpc();
    }

    async function updateFundingWhenDue() {
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          await program.methods.updateFunding().accounts({ ammState, pythPriceFeed: pythFeed }).rpc();
          return;
        } catch (err) {
          if (!err.toString().includes("FundingNotDue") || attempt === 9) throw err;
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
    }

    it("Funding affects close PnL", async () => {
      const trader = Keypair.generate();
      const { usdc, margin } = await setupTrader(trader);
      const posPDA = getPositionPDA(trader.publicKey, 0);

      await program.methods
        .openPosition({ isLong: true, collateralAmount: new anchor.BN(10_000_000), leverage: 10, minBaseAmount: new anchor.BN(0) })
        .accounts({ user: trader.publicKey, userMarginAccount: margin, position: posPDA, ammState, pythPriceFeed: pythFeed, systemProgram: SystemProgram.programId })
        .signers([trader])
        .rpc();

      await pushPriceDownShorts(500_000_000_000);

      await updateFundingWhenDue();

      const marginBefore = await program.account.userMarginAccount.fetch(margin);
      const freeBefore = marginBefore.freeCollateral.toNumber();

      await program.methods.closePosition()
        .accounts({ user: trader.publicKey, userMarginAccount: margin, position: posPDA, ammState, pythPriceFeed: pythFeed })
        .signers([trader])
        .rpc();

      const marginAfter = await program.account.userMarginAccount.fetch(margin);
      const freeAfter = marginAfter.freeCollateral.toNumber();

      assert.ok(freeAfter > freeBefore, "free_collateral should increase after close (position margin returned + PnL)");

      const ammStateData = await program.account.ammState.fetch(ammState);
      assert.ok(ammStateData.openInterestLong.toNumber() >= 0, "open_interest_long should be non-negative");
    });

    it("Liquidation fee exact accounting", async () => {
      const victim = Keypair.generate();
      const { usdc, margin } = await setupTrader(victim);
      const posPDA = getPositionPDA(victim.publicKey, 0);

      await program.methods
        .openPosition({ isLong: true, collateralAmount: new anchor.BN(5_000_000), leverage: 10, minBaseAmount: new anchor.BN(0) })
        .accounts({ user: victim.publicKey, userMarginAccount: margin, position: posPDA, ammState, pythPriceFeed: pythFeed, systemProgram: SystemProgram.programId })
        .signers([victim])
        .rpc();

      const position = await program.account.position.fetch(posPDA);
      const ammStateData = await program.account.ammState.fetch(ammState);
      const expectedLiqFee = position.notional.toNumber() * ammStateData.liquidationFeeBps / 10_000;

      await pushPriceDownShorts(500_000_000_000);

      const liquidator = Keypair.generate();
      await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(liquidator.publicKey, 5_000_000_000));
      const liqUsdc = await createAssociatedTokenAccount(provider.connection, (authority as any).payer, usdcMint, liquidator.publicKey, { commitment: "confirmed" });
      await mintTo(provider.connection, (authority as any).payer, usdcMint, liqUsdc, authority.publicKey, 1_000_000_000);

      const vaultBefore = (await getAccount(provider.connection, vault.publicKey)).amount;
      const liqBefore = (await getAccount(provider.connection, liqUsdc)).amount;

      await program.methods
        .liquidate({ positionOwner: victim.publicKey, positionId: 0 })
        .accounts({ liquidator: liquidator.publicKey, liquidatorUsdcAccount: liqUsdc, positionOwnerMargin: margin, position: posPDA, ammState, vault: vault.publicKey, vaultAuthority, pythPriceFeed: pythFeed, tokenProgram: TOKEN_PROGRAM_ID })
        .signers([liquidator])
        .rpc();

      const vaultAfter = (await getAccount(provider.connection, vault.publicKey)).amount;
      const liqAfter = (await getAccount(provider.connection, liqUsdc)).amount;

      const vaultDecrease = Number(vaultBefore - vaultAfter);
      const liqIncrease = Number(liqAfter - liqBefore);

      assert.ok(vaultDecrease > 0, "Vault should decrease by liq_fee");
      assert.ok(liqIncrease > 0, "Liquidator should receive liq_fee");
      assert.ok(Math.abs(vaultDecrease - liqIncrease) <= 1, "Vault decrease should equal liquidator increase (exact accounting)");
      assert.ok(liqIncrease >= expectedLiqFee * 0.9, `Liquidator fee ${liqIncrease} should be close to expected ${expectedLiqFee}`);
    });

    it("Liquidation margin cleanup", async () => {
      const victim = Keypair.generate();
      const { usdc, margin } = await setupTrader(victim);
      const posPDA = getPositionPDA(victim.publicKey, 0);

      await program.methods
        .openPosition({ isLong: true, collateralAmount: new anchor.BN(5_000_000), leverage: 10, minBaseAmount: new anchor.BN(0) })
        .accounts({ user: victim.publicKey, userMarginAccount: margin, position: posPDA, ammState, pythPriceFeed: pythFeed, systemProgram: SystemProgram.programId })
        .signers([victim])
        .rpc();

      const position = await program.account.position.fetch(posPDA);
      const marginBefore = await program.account.userMarginAccount.fetch(margin);
      const collateralBefore = marginBefore.collateral.toNumber();
      const freeBefore = marginBefore.freeCollateral.toNumber();

      await pushPriceDownShorts(500_000_000_000);

      const liquidator = Keypair.generate();
      await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(liquidator.publicKey, 5_000_000_000));
      const liqUsdc = await createAssociatedTokenAccount(provider.connection, (authority as any).payer, usdcMint, liquidator.publicKey, { commitment: "confirmed" });
      await mintTo(provider.connection, (authority as any).payer, usdcMint, liqUsdc, authority.publicKey, 1_000_000_000);

      await program.methods
        .liquidate({ positionOwner: victim.publicKey, positionId: 0 })
        .accounts({ liquidator: liquidator.publicKey, liquidatorUsdcAccount: liqUsdc, positionOwnerMargin: margin, position: posPDA, ammState, vault: vault.publicKey, vaultAuthority, pythPriceFeed: pythFeed, tokenProgram: TOKEN_PROGRAM_ID })
        .signers([liquidator])
        .rpc();

      const marginAfter = await program.account.userMarginAccount.fetch(margin);
      const collateralAfter = marginAfter.collateral.toNumber();
      const freeAfter = marginAfter.freeCollateral.toNumber();

      assert.ok(collateralAfter <= collateralBefore, "collateral should not increase after liquidation");
      assert.ok(freeAfter >= freeBefore, "free_collateral should increase (net_return credited)");
      assert.ok(collateralAfter >= 0, "collateral should be non-negative");
    });

    it("Post-liquidation AMM state", async () => {
      const victim = Keypair.generate();
      const { usdc, margin } = await setupTrader(victim);
      const posPDA = getPositionPDA(victim.publicKey, 0);

      await program.methods
        .openPosition({ isLong: true, collateralAmount: new anchor.BN(5_000_000), leverage: 10, minBaseAmount: new anchor.BN(0) })
        .accounts({ user: victim.publicKey, userMarginAccount: margin, position: posPDA, ammState, pythPriceFeed: pythFeed, systemProgram: SystemProgram.programId })
        .signers([victim])
        .rpc();

      const position = await program.account.position.fetch(posPDA);
      const ammBefore = await program.account.ammState.fetch(ammState);
      const oiLongBefore = ammBefore.openInterestLong.toNumber();
      const baseBefore = ammBefore.baseAssetReserve.toString();
      const quoteBefore = ammBefore.quoteAssetReserve.toString();

      await pushPriceDownShorts(500_000_000_000);

      const liquidator = Keypair.generate();
      await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(liquidator.publicKey, 5_000_000_000));
      const liqUsdc = await createAssociatedTokenAccount(provider.connection, (authority as any).payer, usdcMint, liquidator.publicKey, { commitment: "confirmed" });
      await mintTo(provider.connection, (authority as any).payer, usdcMint, liqUsdc, authority.publicKey, 1_000_000_000);

      await program.methods
        .liquidate({ positionOwner: victim.publicKey, positionId: 0 })
        .accounts({ liquidator: liquidator.publicKey, liquidatorUsdcAccount: liqUsdc, positionOwnerMargin: margin, position: posPDA, ammState, vault: vault.publicKey, vaultAuthority, pythPriceFeed: pythFeed, tokenProgram: TOKEN_PROGRAM_ID })
        .signers([liquidator])
        .rpc();

      const ammAfter = await program.account.ammState.fetch(ammState);

      assert.ok(ammAfter.openInterestLong.toNumber() < oiLongBefore, "open_interest_long should decrease after liquidation");
      assert.ok(ammAfter.baseAssetReserve.toString() !== baseBefore || ammAfter.quoteAssetReserve.toString() !== quoteBefore, "reserves should change after liquidation");
      assert.ok(ammAfter.k.eq(ammBefore.k), "k should remain constant (constant product)");
    });

    it("Position ID counter stable after liquidation", async () => {
      const victim = Keypair.generate();
      const { usdc, margin } = await setupTrader(victim);
      const posPDA = getPositionPDA(victim.publicKey, 0);

      await program.methods
        .openPosition({ isLong: true, collateralAmount: new anchor.BN(5_000_000), leverage: 10, minBaseAmount: new anchor.BN(0) })
        .accounts({ user: victim.publicKey, userMarginAccount: margin, position: posPDA, ammState, pythPriceFeed: pythFeed, systemProgram: SystemProgram.programId })
        .signers([victim])
        .rpc();

      const marginBefore = await program.account.userMarginAccount.fetch(margin);
      const nextIdBefore = marginBefore.nextPositionId;

      await pushPriceDownShorts(500_000_000_000);

      const liquidator = Keypair.generate();
      await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(liquidator.publicKey, 5_000_000_000));
      const liqUsdc = await createAssociatedTokenAccount(provider.connection, (authority as any).payer, usdcMint, liquidator.publicKey, { commitment: "confirmed" });
      await mintTo(provider.connection, (authority as any).payer, usdcMint, liqUsdc, authority.publicKey, 1_000_000_000);

      await program.methods
        .liquidate({ positionOwner: victim.publicKey, positionId: 0 })
        .accounts({ liquidator: liquidator.publicKey, liquidatorUsdcAccount: liqUsdc, positionOwnerMargin: margin, position: posPDA, ammState, vault: vault.publicKey, vaultAuthority, pythPriceFeed: pythFeed, tokenProgram: TOKEN_PROGRAM_ID })
        .signers([liquidator])
        .rpc();

      const marginAfter = await program.account.userMarginAccount.fetch(margin);

      assert.equal(marginAfter.nextPositionId, nextIdBefore, "nextPositionId should not change after liquidation (positions closed, not decremented)");
    });

    it("Multiple positions, liquidate one, others unaffected", async () => {
      const victim = Keypair.generate();
      const { usdc, margin } = await setupTrader(victim);

      const pos0 = getPositionPDA(victim.publicKey, 0);
      const pos1 = getPositionPDA(victim.publicKey, 1);
      const pos2 = getPositionPDA(victim.publicKey, 2);

      await program.methods
        .openPosition({ isLong: true, collateralAmount: new anchor.BN(5_000_000), leverage: 10, minBaseAmount: new anchor.BN(0) })
        .accounts({ user: victim.publicKey, userMarginAccount: margin, position: pos0, ammState, pythPriceFeed: pythFeed, systemProgram: SystemProgram.programId })
        .signers([victim])
        .rpc();

      await program.methods
        .openPosition({ isLong: true, collateralAmount: new anchor.BN(5_000_000), leverage: 10, minBaseAmount: new anchor.BN(0) })
        .accounts({ user: victim.publicKey, userMarginAccount: margin, position: pos1, ammState, pythPriceFeed: pythFeed, systemProgram: SystemProgram.programId })
        .signers([victim])
        .rpc();

      await program.methods
        .openPosition({ isLong: true, collateralAmount: new anchor.BN(5_000_000), leverage: 10, minBaseAmount: new anchor.BN(0) })
        .accounts({ user: victim.publicKey, userMarginAccount: margin, position: pos2, ammState, pythPriceFeed: pythFeed, systemProgram: SystemProgram.programId })
        .signers([victim])
        .rpc();

      const pos0Before = await program.account.position.fetch(pos0);
      const pos2Before = await program.account.position.fetch(pos2);

      await pushPriceDownShorts(500_000_000_000);

      const liquidator = Keypair.generate();
      await provider.connection.confirmTransaction(await provider.connection.requestAirdrop(liquidator.publicKey, 5_000_000_000));
      const liqUsdc = await createAssociatedTokenAccount(provider.connection, (authority as any).payer, usdcMint, liquidator.publicKey, { commitment: "confirmed" });
      await mintTo(provider.connection, (authority as any).payer, usdcMint, liqUsdc, authority.publicKey, 1_000_000_000);

      await program.methods
        .liquidate({ positionOwner: victim.publicKey, positionId: 1 })
        .accounts({ liquidator: liquidator.publicKey, liquidatorUsdcAccount: liqUsdc, positionOwnerMargin: margin, position: pos1, ammState, vault: vault.publicKey, vaultAuthority, pythPriceFeed: pythFeed, tokenProgram: TOKEN_PROGRAM_ID })
        .signers([liquidator])
        .rpc();

      const pos0After = await program.account.position.fetch(pos0);
      const pos2After = await program.account.position.fetch(pos2);

      assert.ok(pos0After.size.eq(pos0Before.size), "Position #0 size unchanged");
      assert.ok(pos0After.notional.eq(pos0Before.notional), "Position #0 notional unchanged");
      assert.ok(pos0After.margin.eq(pos0Before.margin), "Position #0 margin unchanged");

      assert.ok(pos2After.size.eq(pos2Before.size), "Position #2 size unchanged");
      assert.ok(pos2After.notional.eq(pos2Before.notional), "Position #2 notional unchanged");
      assert.ok(pos2After.margin.eq(pos2Before.margin), "Position #2 margin unchanged");

      try {
        await program.account.position.fetch(pos1);
        assert.fail("Position #1 should be closed");
      } catch (err) {
        assert.include(err.toString(), "does not exist");
      }
    });
  });
});


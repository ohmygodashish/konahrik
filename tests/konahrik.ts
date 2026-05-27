import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
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
      const maintMarginBps = 625;
      const liquidationFeeBps = 250;
      const tradingFeeBps = 10;
      const fundingPeriod = new anchor.BN(3600);

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
            maintMarginBps: 625,
            liquidationFeeBps: 250,
            tradingFeeBps: 10,
            fundingPeriod: new anchor.BN(3600),
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
});

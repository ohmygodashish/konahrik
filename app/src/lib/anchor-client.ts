import { AnchorProvider, Program, type Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import type { AnchorWallet } from "@solana/wallet-adapter-react";
import type { Konahrik } from "@/types/konahrik";
import IDL_JSON from "@/types/konahrik.json";
import { PROGRAM_ID, LOCALNET_RPC } from "./constants";

const IDL = IDL_JSON as unknown as Konahrik;

export const getProvider = (wallet: AnchorWallet, rpcUrl?: string) =>
  new AnchorProvider(
    new Connection(rpcUrl || LOCALNET_RPC, "confirmed"),
    wallet,
    {
      commitment: "confirmed",
    }
  );

export const getProgram = (wallet: AnchorWallet, rpcUrl?: string): Program<Konahrik> =>
  new Program(IDL, getProvider(wallet, rpcUrl));

export const getAmmStatePDA = () =>
  PublicKey.findProgramAddressSync([Buffer.from("amm_state")], PROGRAM_ID);

export const getMarginPDA = (user: PublicKey) =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("margin"), user.toBuffer()],
    PROGRAM_ID
  );

export const getPositionPDA = (user: PublicKey, positionId: number) => {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(positionId, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("position"), user.toBuffer(), buffer],
    PROGRAM_ID
  );
};

export const getVaultAuthorityPDA = () =>
  PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority")],
    PROGRAM_ID
  );

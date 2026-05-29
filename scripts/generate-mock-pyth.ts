import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";

const PYTH_SOL_USD_FEED = "7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE";
const PYTH_PROGRAM_ID = "rec5EKMGg6MxZYaMdyBfgwp4d5rB4pK1pz8g7sFQnBv";

function computeDiscriminator(accountName: string): Buffer {
  const hash = crypto.createHash("sha256").update(`account:${accountName}`).digest();
  return hash.slice(0, 8);
}

function serializePriceFeedMessage(buf: number[]): void {
  const feedId = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) buf.push(feedId[i]);

  const price = BigInt(140_000_000);
  const priceBuf = Buffer.alloc(8);
  priceBuf.writeBigInt64LE(price, 0);
  for (let i = 0; i < 8; i++) buf.push(priceBuf[i]);

  const conf = BigInt(100);
  const confBuf = Buffer.alloc(8);
  confBuf.writeBigUInt64LE(conf, 0);
  for (let i = 0; i < 8; i++) buf.push(confBuf[i]);

  const exponent = -6;
  const expBuf = Buffer.alloc(4);
  expBuf.writeInt32LE(exponent, 0);
  for (let i = 0; i < 4; i++) buf.push(expBuf[i]);

  const publishTime = BigInt(2_000_000_000);
  const ptBuf = Buffer.alloc(8);
  ptBuf.writeBigInt64LE(publishTime, 0);
  for (let i = 0; i < 8; i++) buf.push(ptBuf[i]);

  const prevPublishTime = BigInt(1_999_999_000);
  const pptBuf = Buffer.alloc(8);
  pptBuf.writeBigInt64LE(prevPublishTime, 0);
  for (let i = 0; i < 8; i++) buf.push(pptBuf[i]);

  const emaPrice = BigInt(140_000_000);
  const emaBuf = Buffer.alloc(8);
  emaBuf.writeBigInt64LE(emaPrice, 0);
  for (let i = 0; i < 8; i++) buf.push(emaBuf[i]);

  const emaConf = BigInt(100);
  const emaConfBuf = Buffer.alloc(8);
  emaConfBuf.writeBigUInt64LE(emaConf, 0);
  for (let i = 0; i < 8; i++) buf.push(emaConfBuf[i]);
}

function serializeVerificationLevel(buf: number[]): void {
  buf.push(1);
}

function serializePriceUpdateV2(): Buffer {
  const buf: number[] = [];

  const discriminator = computeDiscriminator("PriceUpdateV2");
  for (let i = 0; i < 8; i++) buf.push(discriminator[i]);

  const writeAuthority = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) buf.push(writeAuthority[i]);

  serializeVerificationLevel(buf);

  serializePriceFeedMessage(buf);

  const postedSlot = BigInt(100_000_000);
  const slotBuf = Buffer.alloc(8);
  slotBuf.writeBigUInt64LE(postedSlot, 0);
  for (let i = 0; i < 8; i++) buf.push(slotBuf[i]);

  return Buffer.from(buf);
}

const accountData = serializePriceUpdateV2();
const base64Data = accountData.toString("base64");

const accountJson = {
  pubkey: PYTH_SOL_USD_FEED,
  account: {
    lamports: 1_000_000,
    data: [base64Data, "base64"],
    owner: PYTH_PROGRAM_ID,
    executable: false,
    rentEpoch: 0,
  },
};

const outputPath = path.join(__dirname, "..", "tests", "fixtures", "pyth-sol-usd.json");
fs.writeFileSync(outputPath, JSON.stringify(accountJson, null, 2));
console.log(`Mock Pyth account written to ${outputPath}`);
console.log(`Account size: ${accountData.length} bytes`);
console.log(`Price: $140 (140_000_000 in 1e6 scale)`);
console.log(`Publish time: 2_000_000_000 (year ~2033)`);

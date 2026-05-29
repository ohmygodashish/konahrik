/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/konahrik.json`.
 */
export type Konahrik = {
  "address": "9HBoParaQQoyCRDEgq3REHkrqtnuwc3hVhQ3C7VDBJyk",
  "metadata": {
    "name": "konahrik",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Created with Anchor"
  },
  "instructions": [
    {
      "name": "closePosition",
      "discriminator": [
        123,
        134,
        81,
        0,
        49,
        68,
        98,
        98
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "userMarginAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  103,
                  105,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "account",
                "path": "position.position_id",
                "account": "position"
              }
            ]
          }
        },
        {
          "name": "ammState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  109,
                  109,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "pythPriceFeed"
        }
      ],
      "args": []
    },
    {
      "name": "depositMargin",
      "discriminator": [
        240,
        96,
        57,
        37,
        173,
        174,
        158,
        219
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "userMarginAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  103,
                  105,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "ammState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  109,
                  109,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "userUsdcAccount",
          "writable": true
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initializeAmm",
      "discriminator": [
        44,
        175,
        253,
        31,
        47,
        138,
        50,
        68
      ],
      "accounts": [
        {
          "name": "authority",
          "writable": true,
          "signer": true
        },
        {
          "name": "ammState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  109,
                  109,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "vault",
          "writable": true,
          "signer": true
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "usdcMint"
        },
        {
          "name": "pythFeed"
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        },
        {
          "name": "rent",
          "address": "SysvarRent111111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "initializeAmmParams"
            }
          }
        }
      ]
    },
    {
      "name": "openPosition",
      "discriminator": [
        135,
        128,
        47,
        77,
        15,
        152,
        240,
        49
      ],
      "accounts": [
        {
          "name": "user",
          "writable": true,
          "signer": true
        },
        {
          "name": "userMarginAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  103,
                  105,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "position",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  115,
                  105,
                  116,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "user"
              },
              {
                "kind": "account",
                "path": "user_margin_account.next_position_id",
                "account": "userMarginAccount"
              }
            ]
          }
        },
        {
          "name": "ammState",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  109,
                  109,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "pythPriceFeed"
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "openPositionParams"
            }
          }
        }
      ]
    },
    {
      "name": "withdrawMargin",
      "discriminator": [
        124,
        222,
        8,
        141,
        181,
        108,
        15,
        176
      ],
      "accounts": [
        {
          "name": "user",
          "signer": true
        },
        {
          "name": "userMarginAccount",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  109,
                  97,
                  114,
                  103,
                  105,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "user"
              }
            ]
          }
        },
        {
          "name": "userUsdcAccount",
          "writable": true
        },
        {
          "name": "vault",
          "writable": true
        },
        {
          "name": "vaultAuthority",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116,
                  95,
                  97,
                  117,
                  116,
                  104,
                  111,
                  114,
                  105,
                  116,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "ammState",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  109,
                  109,
                  95,
                  115,
                  116,
                  97,
                  116,
                  101
                ]
              }
            ]
          }
        },
        {
          "name": "tokenProgram",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "ammState",
      "discriminator": [
        66,
        127,
        244,
        168,
        102,
        12,
        95,
        2
      ]
    },
    {
      "name": "position",
      "discriminator": [
        170,
        188,
        143,
        228,
        122,
        64,
        247,
        208
      ]
    },
    {
      "name": "userMarginAccount",
      "discriminator": [
        17,
        161,
        163,
        154,
        196,
        164,
        228,
        173
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "invalidLeverage",
      "msg": "Invalid leverage. Must be 1-10."
    },
    {
      "code": 6001,
      "name": "insufficientMargin",
      "msg": "Insufficient margin."
    },
    {
      "code": 6002,
      "name": "insufficientMarginForFee",
      "msg": "Insufficient margin to cover fees."
    },
    {
      "code": 6003,
      "name": "insufficientAmount",
      "msg": "Insufficient amount."
    },
    {
      "code": 6004,
      "name": "mathOverflow",
      "msg": "Arithmetic overflow."
    },
    {
      "code": 6005,
      "name": "slippageExceeded",
      "msg": "Slippage tolerance exceeded."
    },
    {
      "code": 6006,
      "name": "oracleStaleness",
      "msg": "Oracle price is stale."
    },
    {
      "code": 6007,
      "name": "oracleConfidence",
      "msg": "Oracle confidence too wide."
    },
    {
      "code": 6008,
      "name": "positionNotLiquidatable",
      "msg": "Position is not liquidatable."
    },
    {
      "code": 6009,
      "name": "fundingNotDue",
      "msg": "Funding period has not elapsed."
    },
    {
      "code": 6010,
      "name": "unauthorized",
      "msg": "Unauthorized."
    },
    {
      "code": 6011,
      "name": "withdrawalExceedsAvailable",
      "msg": "Withdrawal exceeds free collateral."
    },
    {
      "code": 6012,
      "name": "insufficientLiquidity",
      "msg": "Insufficient liquidity in vAMM."
    }
  ],
  "types": [
    {
      "name": "ammState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "type": "pubkey"
          },
          {
            "name": "baseAssetReserve",
            "type": "u128"
          },
          {
            "name": "quoteAssetReserve",
            "type": "u128"
          },
          {
            "name": "k",
            "type": "u128"
          },
          {
            "name": "cumulativeFundingRate",
            "type": "i128"
          },
          {
            "name": "lastFundingTs",
            "type": "i64"
          },
          {
            "name": "openInterestLong",
            "type": "u64"
          },
          {
            "name": "openInterestShort",
            "type": "u64"
          },
          {
            "name": "usdcMint",
            "type": "pubkey"
          },
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "pythFeed",
            "type": "pubkey"
          },
          {
            "name": "initialMarginBps",
            "type": "u16"
          },
          {
            "name": "maintMarginBps",
            "type": "u16"
          },
          {
            "name": "liquidationFeeBps",
            "type": "u16"
          },
          {
            "name": "tradingFeeBps",
            "type": "u16"
          },
          {
            "name": "fundingPeriod",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "initializeAmmParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "initialBaseReserve",
            "type": "u128"
          },
          {
            "name": "initialQuoteReserve",
            "type": "u128"
          },
          {
            "name": "initialMarginBps",
            "type": "u16"
          },
          {
            "name": "maintMarginBps",
            "type": "u16"
          },
          {
            "name": "liquidationFeeBps",
            "type": "u16"
          },
          {
            "name": "tradingFeeBps",
            "type": "u16"
          },
          {
            "name": "fundingPeriod",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "openPositionParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "isLong",
            "type": "bool"
          },
          {
            "name": "collateralAmount",
            "type": "u64"
          },
          {
            "name": "leverage",
            "type": "u8"
          },
          {
            "name": "minBaseAmount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "position",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "positionId",
            "type": "u32"
          },
          {
            "name": "isLong",
            "type": "bool"
          },
          {
            "name": "size",
            "type": "u64"
          },
          {
            "name": "notional",
            "type": "u64"
          },
          {
            "name": "entryPrice",
            "type": "u64"
          },
          {
            "name": "margin",
            "type": "u64"
          },
          {
            "name": "fundingSnapshot",
            "type": "i128"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "userMarginAccount",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "collateral",
            "type": "u64"
          },
          {
            "name": "freeCollateral",
            "type": "u64"
          },
          {
            "name": "nextPositionId",
            "type": "u32"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ]
};

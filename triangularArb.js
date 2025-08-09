// triangularArb.js
const {
    deserializeInstruction,
    getAddressLookupTableAccounts,
    simulateTransaction,
    createVersionedTransaction,
  } = require("./transactionUtils");
  const { getTokenInfo, getAveragePriorityFee } = require("./utils");
  const { getQuote, getSwapInstructions } = require("./jupiterApi");
  const {
    createJitoBundle,
    sendJitoBundle,
    checkBundleStatus,
  } = require("./jitoService");
  const { SOLANA_RPC_URL } = require("./config");
  
  const bs58 = require("bs58");
  const {
    Connection,
    Keypair,
    PublicKey,
  } = require("@solana/web3.js");
  
  const { readFileSync } = require("fs");
  const { homedir } = require("os");
  const { join } = require("path");
  const { bootstrap } = require('global-agent');

  process.env.GLOBAL_AGENT_HTTP_PROXY = 'http://172.19.32.1:7078';
  bootstrap();

  const connection = new Connection(SOLANA_RPC_URL);
  
  const getPrivateKey = () => {
    const privateKeyPath = join(homedir(), ".config", "solana", "id.json");
    const privateKeyBuffer = readFileSync(privateKeyPath);
    const privateKeyArray = JSON.parse(privateKeyBuffer.toString());
    return Uint8Array.from(privateKeyArray);
  };
  
  const wallet = Keypair.fromSecretKey(getPrivateKey());
  
  const MIDDLE_TOKENS = [
    { symbol: "SOL", mint: "So11111111111111111111111111111111111111112", decimals: 9 },
    { symbol: "USDC", mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
    { symbol: "USDT", mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6 },
    { symbol: "mSOL", mint: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So", decimals: 9 },
    { symbol: "JitoSOL", mint: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", decimals: 9 },
    { symbol: "BONK", mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", decimals: 5 },
    { symbol: "JupSOL", mint: "jupSoLaHXQiZZTSfEWMTRRgpnyFm8f6sZdosWBjx93v", decimals: 9 },
    { symbol: "USELESS", mint: "Dz9mQ9NzkBcCsuGPFJ3r1bS4wgqKMHBPiVuniW8Mbonk", decimals: 6 },
    { symbol: "PENGU", mint: "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv", decimals: 6 },
    { symbol: "RAY", mint: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", decimals: 6 },
    { symbol: "Pege", mint: "G4ZgRBCFYMEm3JmFRg29epeTTWrWt8kbhjgsY8BFpump", decimals: 6 },
    { symbol: "TRUMP", mint: "6p6xgHyF7AeE6TZkSmFsko444wqoP15icUSqi2jfGiPN", decimals: 6 },
    { symbol: "MEW", mint: "MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5", decimals: 5 },
    { symbol: "SPX", mint: "J3NKxxXZcnNiMjKw9hYb2K4LUxgwB6t1FtPtQVsv3KFr", decimals: 8 },
    { symbol: "POPCAT", mint: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr", decimals: 9 },
    { symbol: "WBTC", mint: "5XZw2LKTyrfvfiskJ78AMpackRjPcyCif1WhUsPDuVqQ", decimals: 8 },
    { symbol: "WIF", mint: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", decimals: 6 },
    { symbol: "PEPE", mint: "FVxWs1XeUEYECwqEDjor9WqCwRdW9TwkEubs5ACmuEYi", decimals: 6 },
  ];
  
  
  function getSymbolByMint(mintAddress) {
    const token = MIDDLE_TOKENS.find(t => t.mint === mintAddress);
    return token ? token.symbol : "Unknown";
  }
  
  function getDecimalsByMint(mintAddress) {
   const token = MIDDLE_TOKENS.find(t => t.mint === mintAddress);
   return token ? token.decimals : null; // 或默认值，比如 9
  }
  
  
  
  async function getTokenBalance(walletPubkey, tokenMint) {
    const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
    const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
  
    const ata = await PublicKey.findProgramAddress(
      [
        walletPubkey.toBuffer(),
        TOKEN_PROGRAM_ID.toBuffer(),
        new PublicKey(tokenMint).toBuffer()
      ],
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
  
    const accountInfo = await connection.getParsedAccountInfo(ata[0]);
  
    if (!accountInfo.value) return 0;
  
    try {
      const amount = accountInfo.value.data.parsed.info.tokenAmount.uiAmount;
      return amount || 0;
    } catch (e) {
      return 0;
    }
  }

  async function triangularArbitrageMiddleToken({
    middleToken,
    baseAmount = 0.0013,
    slippageBps = 30,
    profitThreshold = 5000,
  }) {
    const SOL_MINT = "So11111111111111111111111111111111111111112";
    try {
      const adjustedAmount = baseAmount * Math.pow(10, getDecimalsByMint(SOL_MINT));
  
      const quote1 = await getQuote(SOL_MINT, middleToken.mint, adjustedAmount, slippageBps);
      if (!quote1 || !quote1.outAmount) return;
  
      const quote2 = await getQuote(middleToken.mint, SOL_MINT, Number(quote1.outAmount), slippageBps);
      if (!quote2 || !quote2.outAmount) return;
  
      const profit = Number(quote2.outAmount) - adjustedAmount;
      console.log(`${middleToken.symbol} -> Profit: ${profit}`);
  
      if (profit < profitThreshold) return;
  
      const inst1 = await getSwapInstructions(quote1, wallet.publicKey.toString());
      const inst2 = await getSwapInstructions(quote2, wallet.publicKey.toString());
  
      const instructions = [
        ...inst1.setupInstructions.map(deserializeInstruction),
        deserializeInstruction(inst1.swapInstruction),
        ...(inst1.cleanupInstruction ? [deserializeInstruction(inst1.cleanupInstruction)] : []),
        ...inst2.setupInstructions.map(deserializeInstruction),
        deserializeInstruction(inst2.swapInstruction),
        ...(inst2.cleanupInstruction ? [deserializeInstruction(inst2.cleanupInstruction)] : []),
      ];
  
      const allLookupAddresses = Array.from(
        new Set([
          ...inst1.addressLookupTableAddresses,
          ...inst2.addressLookupTableAddresses,
        ])
      );
      const addressLookupTableAccounts = await getAddressLookupTableAccounts(allLookupAddresses);
      const latestBlockhash = await connection.getLatestBlockhash("finalized");
  
      const computeUnits = await simulateTransaction(
        instructions,
        wallet.publicKey,
        addressLookupTableAccounts,
        6
      );
      if (!computeUnits) throw new Error("Simulation failed");
  
      const priorityFee = await getAveragePriorityFee();
  
      const tx = createVersionedTransaction(
        instructions,
        wallet.publicKey,
        addressLookupTableAccounts,
        latestBlockhash.blockhash,
        computeUnits,
        priorityFee
      );
      tx.sign([wallet]);
  
      const bundle = await createJitoBundle(tx, wallet);
      const bundleId = await sendJitoBundle(bundle);
      console.log(`✅ Sent arbitrage bundle for ${middleToken.symbol}: ${bundleId}`);
  
      let status = null;
      for (let retries = 3; retries > 0; retries--) {
        await new Promise((r) => setTimeout(r, 15000));
        status = await checkBundleStatus(bundleId);
        console.log(`Bundle status for ${middleToken.symbol}: ${status?.status}`);
        if (status?.status === "Landed") break;
      }
    } catch (err) {
      console.error(`❌ Arbitrage error for ${middleToken.symbol}:`, err.message);
    }
  }
  
  async function loopArbitrageAllTokens() {
    while (true) {
      for (const token of MIDDLE_TOKENS) {
        await triangularArbitrageMiddleToken({ middleToken: token });
        await new Promise((r) => setTimeout(r, 3000)); // 避免过于频繁
      }
      await new Promise((r) => setTimeout(r, 30000)); // 每轮间隔 30 秒
    }
  }
  
  loopArbitrageAllTokens();
  